import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../lib/i18n";
import type { Book, BookPage } from "../lib/types";

const book: Book = {
  id: 5,
  libraryId: 1,
  seriesId: 1,
  title: "Reader Book",
  sortTitle: "reader book",
  author: null,
  volume: null,
  chapter: null,
  path: "D:/Manga/Reader Book",
  format: "folder",
  fileSize: 256,
  modifiedAt: null,
  pageCount: 3,
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

const pages: BookPage[] = [0, 1, 2].map((pageIndex) => ({
  id: pageIndex + 1,
  bookId: 5,
  pageIndex,
  sourcePath: `${pageIndex + 1}.png`,
  width: 1,
  height: 1,
  byteSize: 64,
}));

const secondBook: Book = {
  ...book,
  id: 6,
  seriesId: 2,
  title: "Fast Reader Book",
  sortTitle: "fast reader book",
  path: "D:/Manga/Fast Reader Book",
  pageCount: 2,
};

const manyPageBook: Book = {
  ...book,
  pageCount: 9,
};

const secondPages: BookPage[] = [0, 1].map((pageIndex) => ({
  id: pageIndex + 10,
  bookId: 6,
  pageIndex,
  sourcePath: `${pageIndex + 1}.png`,
  width: 1,
  height: 1,
  byteSize: 64,
}));

const manyPages: BookPage[] = Array.from({ length: 9 }, (_, pageIndex) => ({
  id: pageIndex + 1,
  bookId: 5,
  pageIndex,
  sourcePath: `${pageIndex + 1}.png`,
  width: 1,
  height: 1,
  byteSize: 64,
}));

const api = vi.hoisted(() => ({
  getBookPages: vi.fn(),
  getBookChapters: vi.fn(),
  listBookmarks: vi.fn(),
  getProgress: vi.fn(),
  getSettings: vi.fn(),
  setSetting: vi.fn(),
  getPageData: vi.fn(),
  saveProgress: vi.fn(),
  recordReadingOpened: vi.fn(),
  addBookmark: vi.fn(),
  removeBookmark: vi.fn(),
}));

vi.mock("../lib/api", () => api);

describe("reader store integration", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    const { __resetReaderPageLoaderForTests, useReaderStore } =
      await import("../stores/readerStore");
    __resetReaderPageLoaderForTests();
    useReaderStore.setState({
      book: null,
      pages: [],
      chapters: [],
      pageCache: new Map(),
      bookmarks: [],
      currentPage: 0,
      loading: false,
      error: null,
      settings: {
        mode: "single",
        direction: "ltr",
        fit: "width",
        zoom: 100,
        background: "#0b0f14",
        brightness: 100,
        contrast: 100,
        saturation: 100,
        rotation: 0,
        grayscale: false,
        sharpen: false,
        trimWhite: false,
        coverSingle: false,
        preferEnhanced: true,
        night: false,
        lowMemory: false,
        controlsLayout: "auto",
        sideClickPaging: true,
        centerClickControls: true,
        doubleClickZoom: true,
        doubleClickInterval: 350,
        ctrlWheelZoom: true,
        wheelPageTurn: true,
        dragPan: true,
      },
    });
    api.getBookPages.mockResolvedValue(pages);
    api.getBookChapters.mockResolvedValue([
      {
        id: 1,
        bookId: 5,
        title: "Reader Book",
        chapterNumber: null,
        startPage: 0,
        pageCount: 3,
        createdAt: "2026-07-08T00:00:00Z",
      },
    ]);
    api.listBookmarks.mockResolvedValue([]);
    api.getProgress.mockResolvedValue({
      bookId: 5,
      currentPage: 1,
      totalPages: 3,
      mode: "double",
      direction: "rtl",
    });
    api.getSettings.mockResolvedValue({
      "reader.fit": "height",
      "reader.zoom": 125,
      "reader.background": "#101010",
      "reader.brightness": 120,
    });
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) =>
      Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` }),
    );
    api.saveProgress.mockResolvedValue(undefined);
    api.recordReadingOpened.mockResolvedValue(undefined);
    api.setSetting.mockResolvedValue({});
    api.addBookmark.mockResolvedValue({ id: 9, bookId: 5, pageIndex: 2, note: null });
  });

  it("opens a book at saved progress, restores reader settings, and preloads nearby pages", async () => {
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);

    expect(useReaderStore.getState().currentPage).toBe(0);
    expect(useReaderStore.getState().settings).toMatchObject({
      mode: "double",
      direction: "rtl",
      fit: "height",
      zoom: 125,
      background: "#101010",
      brightness: 120,
    });
    expect(useReaderStore.getState().pageCache.has(1)).toBe(true);
    expect(api.getBookPages).not.toHaveBeenCalled();
    expect(api.recordReadingOpened).toHaveBeenCalledWith(5, 0);
  });

  it("renders the first page without waiting for chapters and bookmarks", async () => {
    let resolveChapters: (value: []) => void = () => undefined;
    api.getBookChapters.mockReturnValueOnce(
      new Promise<[]>((resolve) => {
        resolveChapters = resolve;
      }),
    );
    const { useReaderStore } = await import("../stores/readerStore");

    const opening = useReaderStore.getState().openBook(book);
    expect(useReaderStore.getState().book?.id).toBe(5);
    expect(useReaderStore.getState().loading).toBe(true);

    await opening;
    expect(useReaderStore.getState().loading).toBe(false);
    expect(useReaderStore.getState().pageCache.get(1)?.dataUrl).toBe("data:1");
    expect(useReaderStore.getState().chapters).toEqual([]);

    resolveChapters([]);
    await Promise.resolve();
  });

  it("waits for persisted source settings before materializing the first image", async () => {
    let resolveSettings: (value: Record<string, unknown>) => void = () => undefined;
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockReturnValueOnce(
      new Promise<Record<string, unknown>>((resolve) => {
        resolveSettings = resolve;
      }),
    );
    const { useReaderStore } = await import("../stores/readerStore");

    const opening = useReaderStore.getState().openBook(book);
    await Promise.resolve();
    await Promise.resolve();

    expect(api.getPageData).not.toHaveBeenCalled();
    expect(useReaderStore.getState().loading).toBe(true);

    resolveSettings({ "reader.fit": "height" });
    await opening;
    expect(api.getPageData).toHaveBeenCalledWith(book.id, 0, {
      trimWhite: false,
      sharpen: false,
    });
    expect(useReaderStore.getState().settings.fit).toBe("height");
  });

  it("ignores stale metadata when another book is opened before the first resolves", async () => {
    let resolveSlowChapters: (value: []) => void = () => undefined;
    api.getBookChapters.mockImplementation((bookId: number) => {
      if (bookId === book.id) {
        return new Promise<[]>((resolve) => {
          resolveSlowChapters = resolve;
        });
      }
      return Promise.resolve([
        {
          id: bookId,
          bookId,
          title: bookId === secondBook.id ? secondBook.title : book.title,
          chapterNumber: null,
          startPage: 0,
          pageCount: bookId === secondBook.id ? secondPages.length : pages.length,
          createdAt: "2026-07-08T00:00:00Z",
        },
      ]);
    });
    api.getProgress.mockResolvedValue(null);
    api.getSettings.mockResolvedValue({});
    const { useReaderStore } = await import("../stores/readerStore");

    const slowOpen = useReaderStore.getState().openBook(book);
    const fastOpen = useReaderStore.getState().openBook(secondBook);
    await fastOpen;
    resolveSlowChapters([]);
    await slowOpen;

    expect(useReaderStore.getState().book?.id).toBe(secondBook.id);
    expect(useReaderStore.getState().pages).toHaveLength(secondBook.pageCount);
    expect(useReaderStore.getState().pageCache.get(0)?.dataUrl).toBe("data:0");
  });

  it("does not let a stalled page load from one book block the next opened book", async () => {
    api.getBookChapters.mockResolvedValue([]);
    api.getProgress.mockResolvedValue(null);
    api.getSettings.mockResolvedValue({});
    api.getPageData.mockImplementation((bookId: number, pageIndex: number) => {
      if (bookId === book.id) return new Promise(() => undefined);
      return Promise.resolve({
        pageIndex,
        mimeType: "image/png",
        dataUrl: `data:book-${bookId}-${pageIndex}`,
      });
    });
    const { useReaderStore } = await import("../stores/readerStore");

    const stalledOpen = useReaderStore.getState().openBook(book);
    await vi.waitFor(() =>
      expect(api.getPageData).toHaveBeenCalledWith(book.id, 0, {
        trimWhite: false,
        sharpen: false,
      }),
    );

    await useReaderStore.getState().openBook(secondBook);
    await stalledOpen;

    expect(useReaderStore.getState().book?.id).toBe(secondBook.id);
    expect(useReaderStore.getState().pageCache.get(0)?.dataUrl).toBe("data:book-6-0");
  });

  it("loads the current page before waiting on neighboring preloads", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    const delayedResolvers: Array<() => void> = [];
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) => {
      if (pageIndex === 0) {
        return Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: "data:current" });
      }
      return new Promise((resolve) => {
        delayedResolvers.push(() =>
          resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` }),
        );
      });
    });
    const { useReaderStore } = await import("../stores/readerStore");

    await useReaderStore.getState().openBook(book);

    expect(useReaderStore.getState().pageCache.get(0)?.dataUrl).toBe("data:current");
    expect(useReaderStore.getState().pageCache.has(1)).toBe(false);
    delayedResolvers.forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("limits background page preloading concurrency", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({
      "reader.mode": "scroll",
      "reader.fit": "height",
    });
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        resolvers.push(() => {
          active -= 1;
          resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` });
        });
      });
    });
    const { useReaderStore } = await import("../stores/readerStore");

    const opening = useReaderStore.getState().openBook(manyPageBook);
    await vi.waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
    resolvers.shift()?.();
    await opening;
    await Promise.resolve();

    expect(maxActive).toBeLessThanOrEqual(3);

    for (let attempt = 0; attempt < manyPages.length + 2; attempt += 1) {
      const batch = resolvers.splice(0);
      if (batch.length === 0) break;
      batch.forEach((resolve) => resolve());
      await Promise.resolve();
    }
  });

  it("reserves a loader slot so page turns bypass stalled background preloads", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({ "reader.mode": "scroll" });
    const requestedPages: number[] = [];
    const resolvers = new Map<number, () => void>();
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) => {
      requestedPages.push(pageIndex);
      if (pageIndex === 0) {
        return Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: "data:0" });
      }
      return new Promise((resolve) => {
        resolvers.set(pageIndex, () =>
          resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` }),
        );
      });
    });
    const { useReaderStore } = await import("../stores/readerStore");

    await useReaderStore.getState().openBook(manyPageBook);
    await Promise.resolve();
    expect(requestedPages).toContain(1);

    const jumping = useReaderStore.getState().goToPage(8);
    await Promise.resolve();
    await Promise.resolve();
    expect(requestedPages).toContain(8);

    resolvers.get(8)?.();
    await jumping;
    for (const resolve of resolvers.values()) resolve();
  });

  it("uses smaller preload windows when low memory mode is enabled", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({
      "reader.mode": "scroll",
      "performance.low_memory": true,
    });
    const requestedPages: number[] = [];
    const resolvers: Array<() => void> = [];
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) => {
      requestedPages.push(pageIndex);
      if (pageIndex === 0) {
        return Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: "data:0" });
      }
      return new Promise((resolve) => {
        resolvers.push(() =>
          resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` }),
        );
      });
    });
    const { useReaderStore } = await import("../stores/readerStore");

    await useReaderStore.getState().openBook(manyPageBook);
    await Promise.resolve();
    await Promise.resolve();

    expect(useReaderStore.getState().settings.lowMemory).toBe(true);
    expect(requestedPages.sort((a, b) => a - b)).toEqual([0, 1]);

    expect(requestedPages.every((page) => page >= 0 && page <= 3)).toBe(true);
    expect(requestedPages.length).toBeLessThanOrEqual(2);
    resolvers.forEach((resolve) => resolve());
  });

  it("turns pages, saves progress, and toggles bookmarks", async () => {
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    vi.useFakeTimers();
    await useReaderStore.getState().next();

    expect(api.saveProgress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(360);
    await useReaderStore.getState().toggleBookmark();

    expect(api.saveProgress).toHaveBeenLastCalledWith(5, 2, 3, "double", "rtl");
    expect(useReaderStore.getState().currentPage).toBe(2);
    expect(useReaderStore.getState().bookmarks).toHaveLength(1);
    vi.useRealTimers();
  });

  it("coalesces rapid progress saves and flushes pending progress on close", async () => {
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    vi.useFakeTimers();

    await useReaderStore.getState().goToPage(0);
    await useReaderStore.getState().goToPage(2);
    expect(api.saveProgress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(360);
    expect(api.saveProgress).toHaveBeenCalledTimes(1);
    expect(api.saveProgress).toHaveBeenLastCalledWith(5, 2, 3, "double", "rtl");

    await useReaderStore.getState().goToPage(1);
    useReaderStore.getState().close();
    expect(api.saveProgress).toHaveBeenCalledTimes(2);
    expect(api.saveProgress).toHaveBeenLastCalledWith(5, 0, 3, "double", "rtl");
    vi.useRealTimers();
  });

  it("retries a transient progress save failure without losing the latest page", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.saveProgress
      .mockRejectedValueOnce(new Error("database busy"))
      .mockResolvedValueOnce(undefined);
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    vi.useFakeTimers();

    await useReaderStore.getState().goToPage(2);
    await vi.advanceTimersByTimeAsync(360);
    await vi.advanceTimersByTimeAsync(800);

    expect(api.saveProgress).toHaveBeenCalledTimes(2);
    expect(api.saveProgress).toHaveBeenLastCalledWith(5, 2, 3, "single", "ltr");
    vi.useRealTimers();
  });

  it("keeps the reader open and retries a failed page load", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getPageData
      .mockRejectedValueOnce(new Error("page unavailable"))
      .mockResolvedValue({ pageIndex: 0, mimeType: "image/png", dataUrl: "data:recovered" });
    const { useReaderStore } = await import("../stores/readerStore");

    await useReaderStore.getState().openBook(book);
    expect(useReaderStore.getState().book?.id).toBe(book.id);
    expect(useReaderStore.getState().error).toBe(t("errorPageUnavailable"));

    await useReaderStore.getState().retryCurrentPage();
    expect(useReaderStore.getState().error).toBeNull();
    expect(useReaderStore.getState().pageCache.get(0)?.dataUrl).toBe("data:recovered");
  });

  it("reloads the current page with opted-in image transforms", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    api.getPageData.mockClear();

    useReaderStore.getState().updateSettings({ trimWhite: true, sharpen: true });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(api.getPageData).toHaveBeenCalledWith(book.id, 0, {
      trimWhite: true,
      sharpen: true,
    });
  });

  it("debounces reader setting persistence", async () => {
    vi.useFakeTimers();
    const { useReaderStore } = await import("../stores/readerStore");
    useReaderStore.getState().updateSettings({ fit: "original", background: "#202020" });
    useReaderStore.getState().updateSettings({ brightness: 130, zoom: 140, rotation: 450 });

    expect(api.setSetting).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);

    expect(api.setSetting).toHaveBeenCalledWith("reader.fit", "original");
    expect(api.setSetting).toHaveBeenCalledWith("reader.background", "#202020");
    expect(api.setSetting).toHaveBeenCalledWith("reader.brightness", 130);
    expect(api.setSetting).toHaveBeenCalledWith("reader.zoom", 140);
    expect(api.setSetting).toHaveBeenCalledWith("reader.rotation", 90);
    expect(api.setSetting).toHaveBeenCalledWith("reader.controls_layout", "auto");
    vi.useRealTimers();
  });

  it("persists control layout without changing the committed page", async () => {
    vi.useFakeTimers();
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    const committedPage = useReaderStore.getState().committedPage;
    const committedFrame = useReaderStore.getState().committedFrames[0];

    useReaderStore.getState().updateSettings({ controlsLayout: "overlay" });
    await vi.advanceTimersByTimeAsync(450);

    expect(api.setSetting).toHaveBeenCalledWith("reader.controls_layout", "overlay");
    expect(useReaderStore.getState().committedPage).toBe(committedPage);
    expect(useReaderStore.getState().committedFrames[0]).toBe(committedFrame);
    vi.useRealTimers();
  });

  it("persists mouse gesture preferences without changing reader content", async () => {
    vi.useFakeTimers();
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    const committedFrame = useReaderStore.getState().committedFrames[0];

    useReaderStore.getState().updateSettings({
      sideClickPaging: false,
      centerClickControls: false,
      doubleClickZoom: false,
      doubleClickInterval: 500,
      ctrlWheelZoom: false,
      wheelPageTurn: false,
      dragPan: false,
    });
    await vi.advanceTimersByTimeAsync(450);

    expect(api.setSetting).toHaveBeenCalledWith("reader.pointer.side_paging", false);
    expect(api.setSetting).toHaveBeenCalledWith("reader.pointer.center_controls", false);
    expect(api.setSetting).toHaveBeenCalledWith("reader.pointer.double_click_zoom", false);
    expect(api.setSetting).toHaveBeenCalledWith("reader.pointer.double_click_interval", 500);
    expect(api.setSetting).toHaveBeenCalledWith("reader.pointer.ctrl_wheel_zoom", false);
    expect(api.setSetting).toHaveBeenCalledWith("reader.pointer.wheel_page_turn", false);
    expect(api.setSetting).toHaveBeenCalledWith("reader.pointer.drag_pan", false);
    expect(useReaderStore.getState().committedFrames[0]).toBe(committedFrame);
    vi.useRealTimers();
  });

  it("uses a distinct page source cache after switching from enhanced to original", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    const enhancedKey = useReaderStore.getState().committedFrames[0].cacheKey;
    api.getPageData.mockClear();
    api.setSetting.mockClear();

    useReaderStore.getState().updateSettings({ preferEnhanced: false });
    await vi.waitFor(() =>
      expect(useReaderStore.getState().committedFrames[0].cacheKey).toContain(":original:"),
    );

    const originalKey = useReaderStore.getState().committedFrames[0].cacheKey;
    expect(originalKey).not.toBe(enhancedKey);
    expect(api.setSetting).toHaveBeenCalledWith("reader.prefer_enhanced_pages", false);
    expect(api.setSetting.mock.invocationCallOrder[0]).toBeLessThan(
      api.getPageData.mock.invocationCallOrder[0],
    );
  });

  it("aligns the active page when switching into double page mode", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(book);
    await useReaderStore.getState().goToPage(1);

    useReaderStore.getState().updateSettings({ mode: "double", coverSingle: false });

    await vi.waitFor(() => expect(useReaderStore.getState().currentPage).toBe(0));
  });

  it("keeps the committed frame and progress unchanged until decode completes", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({});
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(manyPageBook);
    const originalFrame = useReaderStore.getState().committedFrames[0];
    api.saveProgress.mockClear();

    let finishDecode: () => void = () => undefined;
    const decodePromise = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    const originalDecode = Object.getOwnPropertyDescriptor(globalThis.Image.prototype, "decode");
    Object.defineProperty(globalThis.Image.prototype, "decode", {
      configurable: true,
      value: vi.fn(() => decodePromise),
    });
    try {
      const navigation = useReaderStore.getState().goToPage(8);
      await vi.waitFor(() => expect(useReaderStore.getState().loadingPage).toBe(8));

      expect(useReaderStore.getState().requestedPage).toBe(8);
      expect(useReaderStore.getState().committedPage).toBe(0);
      expect(useReaderStore.getState().currentPage).toBe(0);
      expect(useReaderStore.getState().committedFrames[0]).toBe(originalFrame);
      expect(api.saveProgress).not.toHaveBeenCalled();

      finishDecode();
      await navigation;
      expect(useReaderStore.getState().committedPage).toBe(8);
      expect(useReaderStore.getState().committedFrames[0].pageIndex).toBe(8);
    } finally {
      if (originalDecode) {
        Object.defineProperty(globalThis.Image.prototype, "decode", originalDecode);
      } else {
        delete (globalThis.Image.prototype as { decode?: unknown }).decode;
      }
    }
  });

  it("discards an older generation when rapid page requests finish out of order", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({});
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(manyPageBook);
    const resolvers = new Map<
      number,
      (value: { pageIndex: number; mimeType: string; dataUrl: string }) => void
    >();
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) => {
      if (pageIndex < 7) {
        return Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` });
      }
      return new Promise((resolve) => resolvers.set(pageIndex, resolve));
    });

    const first = useReaderStore.getState().goToPage(7);
    const second = useReaderStore.getState().goToPage(8);
    await vi.waitFor(() => expect([...resolvers.keys()]).toEqual(expect.arrayContaining([7, 8])));
    resolvers.get(8)?.({ pageIndex: 8, mimeType: "image/png", dataUrl: "data:8" });
    await second;
    expect(useReaderStore.getState().committedPage).toBe(8);
    resolvers.get(7)?.({ pageIndex: 7, mimeType: "image/png", dataUrl: "data:7" });
    await first;
    expect(useReaderStore.getState().committedPage).toBe(8);
  });

  it("keeps the old frame and old progress when a requested page fails", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({});
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(manyPageBook);
    const originalFrame = useReaderStore.getState().committedFrames[0];
    api.saveProgress.mockClear();
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) =>
      pageIndex === 8
        ? Promise.reject(new Error("page unavailable"))
        : Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` }),
    );

    await useReaderStore.getState().goToPage(8);

    expect(useReaderStore.getState().committedPage).toBe(0);
    expect(useReaderStore.getState().committedFrames[0]).toBe(originalFrame);
    expect(useReaderStore.getState().error).toBe(t("errorPageUnavailable"));
    expect(api.saveProgress).not.toHaveBeenCalled();
  });

  it("commits a double-page group atomically only after both pages are ready", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({ "reader.mode": "double" });
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(manyPageBook);
    const originalPages = useReaderStore.getState().committedFrames.map((frame) => frame.pageIndex);
    const resolvers = new Map<
      number,
      (value: { pageIndex: number; mimeType: string; dataUrl: string }) => void
    >();
    api.getPageData.mockImplementation(
      (_bookId: number, pageIndex: number) =>
        new Promise((resolve) => resolvers.set(pageIndex, resolve)),
    );

    const navigation = useReaderStore.getState().goToPage(4);
    await vi.waitFor(() => expect([...resolvers.keys()]).toEqual(expect.arrayContaining([4, 5])));
    resolvers.get(4)?.({ pageIndex: 4, mimeType: "image/png", dataUrl: "data:4" });
    await Promise.resolve();
    expect(useReaderStore.getState().committedFrames.map((frame) => frame.pageIndex)).toEqual(
      originalPages,
    );
    resolvers.get(5)?.({ pageIndex: 5, mimeType: "image/png", dataUrl: "data:5" });
    await navigation;
    expect(useReaderStore.getState().committedFrames.map((frame) => frame.pageIndex)).toEqual([
      4, 5,
    ]);
  });

  it("keeps the complete old spread when one page in a new spread fails", async () => {
    api.getProgress.mockResolvedValueOnce(null);
    api.getSettings.mockResolvedValueOnce({ "reader.mode": "double" });
    const { useReaderStore } = await import("../stores/readerStore");
    await useReaderStore.getState().openBook(manyPageBook);
    const originalFrames = useReaderStore.getState().committedFrames;
    api.getPageData.mockImplementation((_bookId: number, pageIndex: number) =>
      pageIndex === 5
        ? Promise.reject(new Error("page unavailable"))
        : Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` }),
    );

    await useReaderStore.getState().goToPage(4);

    expect(useReaderStore.getState().committedFrames).toBe(originalFrames);
    expect(useReaderStore.getState().committedPage).toBe(0);
  });
});
