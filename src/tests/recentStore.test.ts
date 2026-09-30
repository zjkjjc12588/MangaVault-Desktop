import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book, RecentReadingItem } from "../lib/types";

const api = vi.hoisted(() => ({
  listRecentReading: vi.fn(),
}));

vi.mock("../lib/api", () => api);

const book: Book = {
  id: 1,
  libraryId: 1,
  seriesId: null,
  title: "Recent Book",
  sortTitle: "recent book",
  author: null,
  volume: null,
  chapter: null,
  path: "D:/Manga/Recent Book.cbz",
  format: "cbz",
  fileSize: 100,
  modifiedAt: null,
  pageCount: 10,
  coverPageIndex: 0,
  coverCacheKey: null,
  isFavorite: false,
  rating: 0,
  status: "available",
  importedAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
  lastReadAt: null,
  progressPercent: 0.2,
  tags: [],
};

const recentItem = (id: number, percent: number, lastReadAt: string): RecentReadingItem => ({
  book: { ...book, id, title: `Book ${id}`, progressPercent: percent },
  currentPage: Math.max(0, Math.round(percent * 10) - 1),
  totalPages: 10,
  progressPercent: percent,
  lastReadAt,
  isFinished: percent >= 0.999,
});

describe("recent reading store", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useRecentStore } = await import("../stores/recentStore");
    useRecentStore.setState({
      items: [],
      total: 0,
      search: "",
      view: "list",
      sort: "recent",
      filter: "all",
      loading: false,
      loadingMore: false,
      loaded: false,
      error: null,
      scrollIndex: 0,
      generation: 0,
    });
  });

  it("loads bounded pages and ignores stale responses", async () => {
    const stale = deferred<{
      items: RecentReadingItem[];
      total: number;
      offset: number;
      limit: number;
    }>();
    api.listRecentReading.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({
      items: [recentItem(2, 0.4, "2026-07-22T12:00:00Z")],
      total: 1,
      offset: 0,
      limit: 80,
    });
    const { useRecentStore } = await import("../stores/recentStore");

    const first = useRecentStore.getState().load(true);
    useRecentStore.getState().setSearch("Book 2");
    const second = useRecentStore.getState().load(true);
    await second;
    stale.resolve({
      items: [recentItem(1, 0.2, "2026-07-21T12:00:00Z")],
      total: 1,
      offset: 0,
      limit: 80,
    });
    await first;

    expect(useRecentStore.getState().items.map((item) => item.book.id)).toEqual([2]);
    expect(api.listRecentReading).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "Book 2", limit: 80, offset: 0 }),
    );
  });

  it("updates filtered progress locally without reloading the whole history", async () => {
    const { useRecentStore } = await import("../stores/recentStore");
    useRecentStore.setState({
      items: [recentItem(1, 0.2, "2026-07-21T12:00:00Z")],
      total: 1,
      filter: "unfinished",
    });

    useRecentStore.getState().updateProgressLocal(1, 9, 1);

    expect(useRecentStore.getState().items).toEqual([]);
    expect(useRecentStore.getState().total).toBe(0);
    expect(api.listRecentReading).not.toHaveBeenCalled();
  });

  it("restores persisted preferences and resets scroll for a changed query", async () => {
    const { useRecentStore } = await import("../stores/recentStore");
    useRecentStore.setState({ scrollIndex: 42 });
    useRecentStore.getState().syncSettings({
      "recent.view": "grid",
      "recent.sort": "title",
      "recent.filter": "30days",
    });
    expect(useRecentStore.getState()).toMatchObject({
      view: "grid",
      sort: "title",
      filter: "30days",
      scrollIndex: 42,
    });

    useRecentStore.getState().setPreferences({ filter: "finished" });
    expect(useRecentStore.getState().scrollIndex).toBe(0);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
