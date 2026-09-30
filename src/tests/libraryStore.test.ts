import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../lib/i18n";
import type { Book, ScanJob } from "../lib/types";

const book: Book = {
  id: 1,
  libraryId: 1,
  seriesId: 1,
  title: "Signal Garden",
  sortTitle: "signal garden",
  author: "Ada",
  volume: 1,
  chapter: 2,
  path: "D:/Manga/Signal Garden",
  format: "folder",
  fileSize: 128,
  modifiedAt: null,
  pageCount: 2,
  coverPageIndex: 0,
  coverCacheKey: null,
  isFavorite: false,
  rating: 0,
  status: "available",
  importedAt: "2026-07-08T00:00:00Z",
  updatedAt: "2026-07-08T00:00:00Z",
  lastReadAt: null,
  progressPercent: 0,
  tags: [],
};

const api = vi.hoisted(() => ({
  chooseImportFolder: vi.fn(),
  chooseImportFiles: vi.fn(),
  importFolder: vi.fn(),
  importPaths: vi.fn(),
  listBooks: vi.fn(),
  listTags: vi.fn(),
  listCategories: vi.fn(),
  listAuthors: vi.fn(),
  listFormats: vi.fn(),
  listScanJobs: vi.fn(),
  retryScan: vi.fn(),
  toggleFavorite: vi.fn(),
  setRating: vi.fn(),
  updateBookMetadata: vi.fn(),
  setBookTags: vi.fn(),
}));

vi.mock("../lib/api", () => api);

describe("library store integration", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.setSystemTime(0);
    const { __resetLibraryRunningRefreshForTests, useLibraryStore } =
      await import("../stores/libraryStore");
    __resetLibraryRunningRefreshForTests();
    useLibraryStore.setState({
      books: [],
      tags: [],
      categories: [],
      authors: [],
      formats: [],
      jobs: [],
      selectedBookId: null,
      query: { sort: "title", limit: 240, offset: 0 },
      view: "grid",
      loading: false,
      loadingMore: false,
      hasMore: false,
      error: null,
    });
    api.listBooks.mockResolvedValue([book]);
    api.listTags.mockResolvedValue(["completed"]);
    api.listCategories.mockResolvedValue(["Manga"]);
    api.listAuthors.mockResolvedValue(["Ada"]);
    api.listFormats.mockResolvedValue(["folder"]);
    api.listScanJobs.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads and filters books through the repository API", async () => {
    const { useLibraryStore } = await import("../stores/libraryStore");
    await useLibraryStore.getState().load();
    await useLibraryStore
      .getState()
      .setQuery({ search: "Signal", duplicatesOnly: true, status: "missing" });

    expect(api.listBooks).toHaveBeenLastCalledWith({
      sort: "title",
      limit: 241,
      offset: 0,
      search: "Signal",
      duplicatesOnly: true,
      status: "missing",
    });
    expect(useLibraryStore.getState().books).toHaveLength(1);
  });

  it("keeps the selected book as shared library state", async () => {
    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.getState().selectBook(1);
    expect(useLibraryStore.getState().selectedBookId).toBe(1);
    useLibraryStore.getState().selectBook(null);
    expect(useLibraryStore.getState().selectedBookId).toBeNull();
  });

  it("loads large libraries in bounded pages", async () => {
    const firstPage = Array.from({ length: 241 }, (_, index) => ({
      ...book,
      id: index + 1,
      title: `Book ${index + 1}`,
    }));
    const secondPage = [
      { ...book, id: 241, title: "Book 241" },
      { ...book, id: 242, title: "Book 242" },
    ];
    api.listBooks.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    const { useLibraryStore } = await import("../stores/libraryStore");
    await useLibraryStore.getState().load();

    expect(useLibraryStore.getState().books).toHaveLength(240);
    expect(useLibraryStore.getState().hasMore).toBe(true);

    await useLibraryStore.getState().loadMore();

    expect(api.listBooks).toHaveBeenLastCalledWith({
      sort: "title",
      limit: 241,
      offset: 240,
    });
    expect(useLibraryStore.getState().books).toHaveLength(242);
    expect(useLibraryStore.getState().books.at(-1)?.id).toBe(242);
    expect(useLibraryStore.getState().hasMore).toBe(false);
  });

  it("reloads with a stable series query when switching to series view", async () => {
    const { useLibraryStore } = await import("../stores/libraryStore");
    await useLibraryStore.getState().load();

    await useLibraryStore.getState().setView("series");

    expect(api.listBooks).toHaveBeenLastCalledWith({
      sort: "title",
      view: "series",
      limit: 241,
      offset: 0,
    });
    expect(useLibraryStore.getState().view).toBe("series");
    expect(useLibraryStore.getState().query.view).toBe("series");
  });

  it("discards an in-flight next page when the query changes", async () => {
    const stalePage = deferred<Book[]>();
    api.listBooks
      .mockReturnValueOnce(stalePage.promise)
      .mockResolvedValueOnce([{ ...book, id: 900, title: "Filtered Result" }]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.setState({
      books: Array.from({ length: 240 }, (_, index) => ({ ...book, id: index + 1 })),
      hasMore: true,
    });

    const loadMore = useLibraryStore.getState().loadMore();
    await Promise.resolve();
    const filter = useLibraryStore.getState().setQuery({ search: "filtered" });
    await filter;
    stalePage.resolve([{ ...book, id: 241, title: "Stale Next Page" }]);
    await loadMore;

    expect(useLibraryStore.getState().books).toEqual([
      { ...book, id: 900, title: "Filtered Result" },
    ]);
    expect(useLibraryStore.getState().loadingMore).toBe(false);
  });

  it("ignores stale library loads when a newer query finishes first", async () => {
    const firstBooks = deferred<Book[]>();
    const secondBooks = deferred<Book[]>();
    api.listBooks.mockReturnValueOnce(firstBooks.promise).mockReturnValueOnce(secondBooks.promise);

    const { useLibraryStore } = await import("../stores/libraryStore");
    const firstLoad = useLibraryStore.getState().load();
    const secondLoad = useLibraryStore.getState().setQuery({ search: "fresh" });

    secondBooks.resolve([{ ...book, id: 2, title: "Fresh Result" }]);
    await secondLoad;
    expect(useLibraryStore.getState().books[0].title).toBe("Fresh Result");

    firstBooks.resolve([{ ...book, id: 3, title: "Stale Result" }]);
    await firstLoad;
    expect(useLibraryStore.getState().books[0].title).toBe("Fresh Result");
    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it("imports folders and saves metadata and tags", async () => {
    api.chooseImportFolder.mockResolvedValue("D:/Manga");
    api.importFolder.mockResolvedValue({ jobId: 7, status: "running" });
    api.listScanJobs.mockResolvedValue([{ id: 7, status: "running" }]);
    api.updateBookMetadata.mockResolvedValue({ ...book, title: "Signal Garden Deluxe" });
    api.setBookTags.mockResolvedValue(["completed", "favorite"]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    await useLibraryStore.getState().importFolder();
    await useLibraryStore.getState().load();
    await useLibraryStore.getState().updateMetadata(1, {
      title: "Signal Garden Deluxe",
      author: "Ada",
      volume: 1,
      chapter: 2,
    });
    await useLibraryStore.getState().setTags(1, ["completed", "favorite"]);

    expect(api.importFolder).toHaveBeenCalledWith("D:/Manga", true);
    expect(useLibraryStore.getState().books[0].title).toBe("Signal Garden Deluxe");
    expect(useLibraryStore.getState().books[0].tags).toEqual(["completed", "favorite"]);
  });

  it("keeps existing metadata when a metadata save fails", async () => {
    api.updateBookMetadata.mockRejectedValueOnce(new Error("database busy"));
    const { useLibraryStore } = await import("../stores/libraryStore");
    await useLibraryStore.getState().load();

    await expect(
      useLibraryStore.getState().updateMetadata(1, {
        title: "Unsaved title",
        author: "Ada",
        volume: 1,
        chapter: 2,
      }),
    ).rejects.toThrow("database busy");

    expect(useLibraryStore.getState().books[0].title).toBe("Signal Garden");
    expect(useLibraryStore.getState().error).toBe(t("errorDatabaseBusy"));
  });

  it("imports selected files and dropped paths", async () => {
    api.chooseImportFiles.mockResolvedValue(["D:/Manga/Signal Garden.cbz"]);
    api.importPaths.mockResolvedValue([{ jobId: 8, status: "running" }]);
    api.listScanJobs.mockResolvedValue([{ id: 8, status: "running" }]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    await useLibraryStore.getState().importFiles();
    const results = await useLibraryStore.getState().importPaths(["D:/Manga/Quiet Signal.pdf"]);

    expect(api.importPaths).toHaveBeenNthCalledWith(1, ["D:/Manga/Signal Garden.cbz"], true);
    expect(api.importPaths).toHaveBeenNthCalledWith(2, ["D:/Manga/Quiet Signal.pdf"], true);
    expect(results).toEqual([{ jobId: 8, status: "running" }]);
    expect(useLibraryStore.getState().jobs).toEqual([{ id: 8, status: "running" }]);
  });

  it("starts imports without blocking the visible library", async () => {
    const runningJob = { id: 8, status: "running" };
    api.chooseImportFolder.mockResolvedValue("D:/HugeManga");
    api.importFolder.mockResolvedValue({ jobId: 8, status: "running" });
    api.listScanJobs.mockResolvedValue([runningJob]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.setState({ books: [book], loading: false });
    await useLibraryStore.getState().importFolder();

    expect(useLibraryStore.getState().loading).toBe(false);
    expect(useLibraryStore.getState().books).toEqual([book]);
    expect(useLibraryStore.getState().jobs).toEqual([runningJob]);
    expect(api.listBooks).not.toHaveBeenCalled();
  });

  it("retries an interrupted scan without blocking the visible library", async () => {
    const queuedJob = { id: 18, status: "queued" };
    api.retryScan.mockResolvedValue(queuedJob);
    api.listScanJobs.mockResolvedValue([queuedJob]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.setState({ books: [book], loading: false });
    await useLibraryStore.getState().retryScan(7);

    expect(api.retryScan).toHaveBeenCalledWith(7);
    expect(useLibraryStore.getState().books).toEqual([book]);
    expect(useLibraryStore.getState().jobs).toEqual([queuedJob]);
  });

  it("refreshes visible books during long-running scans without entering loading state", async () => {
    vi.setSystemTime(6_000);
    const runningJob: ScanJob = {
      id: 9,
      libraryId: 1,
      rootPath: "D:/Manga",
      status: "running",
      discoveredCount: 12,
      importedCount: 3,
      failedCount: 0,
      message: null,
      startedAt: "2026-07-08T00:00:00Z",
      finishedAt: null,
    };
    api.listScanJobs.mockResolvedValue([runningJob]);
    api.listBooks.mockResolvedValue([{ ...book, id: 2, title: "New Arrival" }]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.setState({ jobs: [{ ...runningJob, importedCount: 1 }], loading: false });
    await useLibraryStore.getState().refreshJobs();

    expect(api.listBooks).toHaveBeenCalledWith({
      sort: "title",
      limit: 241,
      offset: 0,
    });
    expect(useLibraryStore.getState().books[0].title).toBe("New Arrival");
    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it("does not apply scan refresh book results after the query changes", async () => {
    vi.setSystemTime(6_000);
    const runningJob: ScanJob = {
      id: 12,
      libraryId: 1,
      rootPath: "D:/Manga",
      status: "running",
      discoveredCount: 12,
      importedCount: 3,
      failedCount: 0,
      message: null,
      startedAt: "2026-07-08T00:00:00Z",
      finishedAt: null,
    };
    const refreshBooks = deferred<Book[]>();
    api.listScanJobs.mockResolvedValue([runningJob]);
    api.listBooks.mockReturnValue(refreshBooks.promise);

    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.setState({
      jobs: [{ ...runningJob, importedCount: 1 }],
      books: [book],
      loading: false,
    });
    const refresh = useLibraryStore.getState().refreshJobs();
    await Promise.resolve();
    expect(api.listBooks).toHaveBeenCalledWith({
      sort: "title",
      limit: 241,
      offset: 0,
    });
    useLibraryStore.setState({ query: { sort: "title", limit: 240, offset: 0, search: "new" } });

    refreshBooks.resolve([{ ...book, id: 4, title: "Old Scan Refresh" }]);
    await refresh;

    expect(useLibraryStore.getState().books[0].title).toBe("Signal Garden");
    expect(useLibraryStore.getState().jobs).toEqual([runningJob]);
  });

  it("keeps large unfiltered scans on lightweight progress refreshes", async () => {
    vi.setSystemTime(6_000);
    const runningJob: ScanJob = {
      id: 10,
      libraryId: 1,
      rootPath: "D:/Manga",
      status: "running",
      discoveredCount: 8_000,
      importedCount: 4_500,
      failedCount: 0,
      message: null,
      startedAt: "2026-07-08T00:00:00Z",
      finishedAt: null,
    };
    api.listScanJobs.mockResolvedValue([runningJob]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.setState({
      jobs: [{ ...runningJob, importedCount: 1 }],
      books: Array.from({ length: 2_500 }, (_, index) => ({ ...book, id: index + 1 })),
      loading: false,
    });
    await useLibraryStore.getState().refreshJobs();

    expect(api.listBooks).not.toHaveBeenCalled();
    expect(api.listTags).not.toHaveBeenCalled();
    expect(api.listAuthors).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().jobs).toEqual([runningJob]);
    expect(useLibraryStore.getState().books).toHaveLength(2_500);
  });

  it("reloads the first library page when a large scan finishes", async () => {
    const runningJob: ScanJob = {
      id: 11,
      libraryId: 1,
      rootPath: "D:/Manga",
      status: "running",
      discoveredCount: 8_000,
      importedCount: 4_500,
      failedCount: 0,
      message: null,
      startedAt: "2026-07-08T00:00:00Z",
      finishedAt: null,
    };
    const completeJob: ScanJob = {
      ...runningJob,
      status: "complete",
      importedCount: 8_000,
      finishedAt: "2026-07-08T00:02:00Z",
    };
    api.listScanJobs.mockResolvedValue([completeJob]);
    api.listBooks.mockResolvedValue([{ ...book, id: 88, title: "Final Arrival" }]);

    const { useLibraryStore } = await import("../stores/libraryStore");
    useLibraryStore.setState({
      jobs: [runningJob],
      books: Array.from({ length: 2_500 }, (_, index) => ({ ...book, id: index + 1 })),
      loading: false,
    });
    await useLibraryStore.getState().refreshJobs();

    expect(api.listBooks).toHaveBeenCalledWith({
      sort: "title",
      limit: 241,
      offset: 0,
    });
    expect(useLibraryStore.getState().books[0].title).toBe("Final Arrival");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
