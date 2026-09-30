import { create } from "zustand";
import * as api from "../lib/api";
import { formatUserError, t } from "../lib/i18n";
import type { Book, BookPage, Bookmark, Chapter, ReaderSettings } from "../lib/types";
import {
  clampZoom,
  nextPageForMode,
  normalizeRotation,
  pageStartForMode,
  previousPageForMode,
  visiblePages,
} from "../reader/readerCore";
import {
  buildPageCacheKey,
  decodePagePayload,
  decodedCacheBudget,
  decodedCacheEntryLimit,
  nextPaint,
  releaseDecodedFrame,
  releaseDecodedFrames,
  retainDecodedFrame,
  touchDecodedFrame,
  type DecodedPageFrame,
} from "../reader/readerPageCache";
import { recordReaderPerformance } from "../reader/readerPerformance";
import { useToastStore } from "./toastStore";

interface ReaderState {
  sessionId: number;
  book: Book | null;
  pages: BookPage[];
  chapters: Chapter[];
  pageCache: Map<number, DecodedPageFrame>;
  committedFrames: DecodedPageFrame[];
  bookmarks: Bookmark[];
  currentPage: number;
  requestedPage: number;
  loadingPage: number | null;
  committedPage: number;
  requestGeneration: number;
  decodedCacheBytes: number;
  loading: boolean;
  error: string | null;
  settings: ReaderSettings;
  openBook: (book: Book, initialPage?: number) => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  retryCurrentPage: () => Promise<void>;
  close: () => void;
  flushProgress: () => Promise<void>;
  toggleBookmark: () => Promise<void>;
  updateSettings: (settings: Partial<ReaderSettings>) => void;
}

const defaultSettings: ReaderSettings = {
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
};

const readerSettingKeys = {
  mode: "reader.mode",
  direction: "reader.direction",
  fit: "reader.fit",
  zoom: "reader.zoom",
  background: "reader.background",
  brightness: "reader.brightness",
  contrast: "reader.contrast",
  saturation: "reader.saturation",
  rotation: "reader.rotation",
  grayscale: "reader.grayscale",
  sharpen: "reader.sharpen",
  trimWhite: "reader.trim_white",
  coverSingle: "reader.cover_single",
  preferEnhanced: "reader.prefer_enhanced_pages",
  night: "reader.night",
  controlsLayout: "reader.controls_layout",
  sideClickPaging: "reader.pointer.side_paging",
  centerClickControls: "reader.pointer.center_controls",
  doubleClickZoom: "reader.pointer.double_click_zoom",
  doubleClickInterval: "reader.pointer.double_click_interval",
  ctrlWheelZoom: "reader.pointer.ctrl_wheel_zoom",
  wheelPageTurn: "reader.pointer.wheel_page_turn",
  dragPan: "reader.pointer.drag_pan",
} satisfies Record<Exclude<keyof ReaderSettings, "lowMemory">, string>;

let persistTimer: number | undefined;
let progressSaveTimer: number | undefined;
const maxConcurrentPageLoads = 3;

interface PendingProgressSave {
  bookId: number;
  currentPage: number;
  totalPages: number;
  mode: ReaderSettings["mode"];
  direction: ReaderSettings["direction"];
  attempts: number;
}
interface PageLoadRequest {
  key: string;
  cacheKey: string;
  bookId: number;
  pageIndex: number;
  priority: boolean;
  generation: number;
  transforms: { trimWhite: boolean; sharpen: boolean };
  fallback: Pick<BookPage, "width" | "height">;
  promise: Promise<DecodedPageFrame>;
  resolve: (payload: DecodedPageFrame) => void;
  reject: (error: unknown) => void;
}

const pageRequests = new Map<string, PageLoadRequest>();
const pageLoadQueue: PageLoadRequest[] = [];
let activePageLoads = 0;
let activeBackgroundPageLoads = 0;
let pageLoadGeneration = 0;
let pendingProgressSave: PendingProgressSave | null = null;
let readerOpenGeneration = 0;
let navigationGeneration = 0;

export function __resetReaderPageLoaderForTests(): void {
  readerOpenGeneration += 1;
  navigationGeneration += 1;
  resetPageLoader();
  releaseCurrentReaderResources();
  window.clearTimeout(persistTimer);
  window.clearTimeout(progressSaveTimer);
  pendingProgressSave = null;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  sessionId: 0,
  book: null,
  pages: [],
  chapters: [],
  pageCache: new Map(),
  committedFrames: [],
  bookmarks: [],
  currentPage: 0,
  requestedPage: 0,
  loadingPage: null,
  committedPage: 0,
  requestGeneration: 0,
  decodedCacheBytes: 0,
  loading: false,
  error: null,
  settings: defaultSettings,
  async openBook(book, initialPage) {
    void flushProgressSave();
    const openGeneration = startReaderSession();
    releaseCurrentReaderResources();
    set({
      sessionId: openGeneration,
      book,
      loading: true,
      error: null,
      pageCache: new Map(),
      committedFrames: [],
      currentPage: 0,
      requestedPage: 0,
      loadingPage: null,
      committedPage: 0,
      requestGeneration: navigationGeneration,
      decodedCacheBytes: 0,
      chapters: [],
      bookmarks: [],
    });
    try {
      const pages = virtualPagesForBook(book);
      const chaptersPromise = api.getBookChapters(book.id);
      const bookmarksPromise = api.listBookmarks(book.id);
      const progressPromise = api.getProgress(book.id);
      const settingsPromise = api.getSettings();
      void attachReaderMetadata(openGeneration, book.id, chaptersPromise, bookmarksPromise);

      const [progress, persistedSettings] = await Promise.all([
        progressPromise.catch(() => null),
        settingsPromise.catch(() => ({})),
      ]);
      const settings = {
        ...get().settings,
        ...settingsFromRecord(persistedSettings),
        ...settingsFromProgress(progress),
      };
      const currentPage = pageStartForMode(
        progress ? progress.currentPage : (initialPage ?? 0),
        pages.length,
        settings.mode,
        settings.coverSingle,
      );
      if (!isActiveReaderSession(openGeneration, book.id)) return;
      set({
        pages,
        settings,
        requestedPage: currentPage,
        loadingPage: currentPage,
      });
      if (pages.length === 0) {
        set({ loading: false, loadingPage: null });
        return;
      }
      const committed = await requestAndCommitPage(currentPage, false);
      if (committed && isActiveReaderSession(openGeneration, book.id)) {
        void api.recordReadingOpened(book.id, currentPage).catch(() => undefined);
      }
    } catch (err) {
      if (isActiveReaderSession(openGeneration, book.id)) {
        set({ error: formatUserError(err), loading: false });
      }
    }
  },
  async goToPage(page) {
    await requestAndCommitPage(page, true);
  },
  async next() {
    const { currentPage, requestedPage, loadingPage, pages, settings } = get();
    const basePage = loadingPage === null ? currentPage : requestedPage;
    await get().goToPage(
      nextPageForMode(basePage, pages.length, settings.mode, settings.coverSingle),
    );
  },
  async previous() {
    const { currentPage, requestedPage, loadingPage, settings } = get();
    const basePage = loadingPage === null ? currentPage : requestedPage;
    await get().goToPage(previousPageForMode(basePage, settings.mode, settings.coverSingle));
  },
  async retryCurrentPage() {
    const { book, currentPage, requestedPage, error } = get();
    if (!book) return;
    set({ error: null });
    await get().goToPage(error ? requestedPage : currentPage);
  },
  close() {
    void flushProgressSave();
    readerOpenGeneration += 1;
    navigationGeneration += 1;
    resetPageLoader();
    releaseCurrentReaderResources();
    set({
      book: null,
      pages: [],
      chapters: [],
      pageCache: new Map(),
      committedFrames: [],
      bookmarks: [],
      currentPage: 0,
      requestedPage: 0,
      loadingPage: null,
      committedPage: 0,
      requestGeneration: navigationGeneration,
      decodedCacheBytes: 0,
      loading: false,
      error: null,
    });
  },
  async flushProgress() {
    await flushProgressSave();
  },
  async toggleBookmark() {
    const { book, bookmarks, currentPage } = get();
    if (!book) return;
    const existing = bookmarks.find((bookmark) => bookmark.pageIndex === currentPage);
    if (existing) {
      await api.removeBookmark(existing.id);
      set({ bookmarks: bookmarks.filter((bookmark) => bookmark.id !== existing.id) });
      useToastStore.getState().push({ title: t("bookmarkRemoved"), tone: "info" });
    } else {
      const bookmark = await api.addBookmark(book.id, currentPage);
      set({ bookmarks: [...bookmarks, bookmark] });
      useToastStore.getState().push({ title: t("bookmarkAdded"), tone: "success" });
    }
  },
  updateSettings(settings) {
    const current = get();
    const next = { ...current.settings, ...normalizePartialSettings(settings) };
    const alignedPage = pageStartForMode(
      current.currentPage,
      current.pages.length,
      next.mode,
      next.coverSingle,
    );
    const changedSourcePreference =
      typeof settings.preferEnhanced === "boolean" &&
      settings.preferEnhanced !== current.settings.preferEnhanced;
    const changedImageTransforms =
      (typeof settings.trimWhite === "boolean" &&
        settings.trimWhite !== current.settings.trimWhite) ||
      (typeof settings.sharpen === "boolean" && settings.sharpen !== current.settings.sharpen);
    const changedMode =
      (typeof settings.mode === "string" && settings.mode !== current.settings.mode) ||
      (typeof settings.coverSingle === "boolean" &&
        settings.coverSingle !== current.settings.coverSingle);
    if (changedSourcePreference || changedImageTransforms) resetPageLoader();
    set({
      settings: next,
    });
    if ((alignedPage !== current.currentPage || changedMode) && current.book) {
      void get().goToPage(alignedPage);
    }
    if (changedImageTransforms && !changedMode) {
      void get().goToPage(get().currentPage);
    }
    if (changedSourcePreference) {
      void api
        .setSetting(readerSettingKeys.preferEnhanced, next.preferEnhanced)
        .then(() => get().goToPage(get().currentPage))
        .catch((err) => {
          useToastStore.getState().push({
            title: t("readerSettingsSaveFailed"),
            description: formatUserError(err),
            tone: "error",
          });
        });
    }
    if (typeof settings.lowMemory === "boolean") trimCacheToCurrentBudget();
    schedulePersistSettings(next);
  },
}));

function virtualPagesForBook(book: Book): BookPage[] {
  return Array.from({ length: Math.max(0, book.pageCount) }, (_, pageIndex) => ({
    id: -(pageIndex + 1),
    bookId: book.id,
    pageIndex,
    sourcePath: "",
    width: null,
    height: null,
    byteSize: null,
  }));
}

function startReaderSession(): number {
  readerOpenGeneration += 1;
  resetPageLoader();
  return readerOpenGeneration;
}

function resetPageLoader(): void {
  pageLoadGeneration += 1;
  activePageLoads = 0;
  activeBackgroundPageLoads = 0;
  pageLoadQueue.splice(0);
  for (const request of pageRequests.values()) {
    request.reject(new Error("reader page loader reset"));
  }
  pageRequests.clear();
}

async function attachReaderMetadata(
  openGeneration: number,
  bookId: number,
  chaptersPromise: Promise<Chapter[]>,
  bookmarksPromise: Promise<Bookmark[]>,
): Promise<void> {
  const [chapters, bookmarks] = await Promise.all([
    chaptersPromise.catch(() => []),
    bookmarksPromise.catch(() => []),
  ]);
  if (!isActiveReaderSession(openGeneration, bookId)) return;
  useReaderStore.setState({ chapters, bookmarks });
}

function isActiveReaderSession(openGeneration: number, bookId: number): boolean {
  return readerOpenGeneration === openGeneration && useReaderStore.getState().book?.id === bookId;
}

function settingsFromRecord(settings: Record<string, unknown>): Partial<ReaderSettings> {
  return normalizePartialSettings({
    mode: settings[readerSettingKeys.mode],
    direction: settings[readerSettingKeys.direction],
    fit: settings[readerSettingKeys.fit],
    zoom: settings[readerSettingKeys.zoom],
    background: settings[readerSettingKeys.background],
    brightness: settings[readerSettingKeys.brightness],
    contrast: settings[readerSettingKeys.contrast],
    saturation: settings[readerSettingKeys.saturation],
    rotation: settings[readerSettingKeys.rotation],
    grayscale: settings[readerSettingKeys.grayscale],
    sharpen: settings[readerSettingKeys.sharpen],
    trimWhite: settings[readerSettingKeys.trimWhite],
    coverSingle: settings[readerSettingKeys.coverSingle],
    preferEnhanced: settings[readerSettingKeys.preferEnhanced],
    night: settings[readerSettingKeys.night],
    lowMemory: settings["performance.low_memory"],
    controlsLayout: settings[readerSettingKeys.controlsLayout],
    sideClickPaging: settings[readerSettingKeys.sideClickPaging],
    centerClickControls: settings[readerSettingKeys.centerClickControls],
    doubleClickZoom: settings[readerSettingKeys.doubleClickZoom],
    doubleClickInterval: settings[readerSettingKeys.doubleClickInterval],
    ctrlWheelZoom: settings[readerSettingKeys.ctrlWheelZoom],
    wheelPageTurn: settings[readerSettingKeys.wheelPageTurn],
    dragPan: settings[readerSettingKeys.dragPan],
  });
}

function settingsFromProgress(
  progress: Awaited<ReturnType<typeof api.getProgress>>,
): Partial<ReaderSettings> {
  if (!progress) return {};
  return normalizePartialSettings({
    mode: progress.mode,
    direction: progress.direction,
  });
}

function normalizePartialSettings(settings: Partial<Record<keyof ReaderSettings, unknown>>) {
  const next: Partial<ReaderSettings> = {};
  if (settings.mode === "single" || settings.mode === "double" || settings.mode === "scroll") {
    next.mode = settings.mode;
  }
  if (settings.direction === "ltr" || settings.direction === "rtl") {
    next.direction = settings.direction;
  }
  if (settings.fit === "width" || settings.fit === "height" || settings.fit === "original") {
    next.fit = settings.fit;
  }
  if (
    settings.controlsLayout === "auto" ||
    settings.controlsLayout === "overlay" ||
    settings.controlsLayout === "reserved"
  ) {
    next.controlsLayout = settings.controlsLayout;
  }
  if (
    settings.doubleClickInterval === 250 ||
    settings.doubleClickInterval === 350 ||
    settings.doubleClickInterval === 500
  ) {
    next.doubleClickInterval = settings.doubleClickInterval;
  }
  if (typeof settings.zoom === "number") {
    next.zoom = clampZoom(settings.zoom);
  }
  if (typeof settings.background === "string" && /^#[0-9a-f]{6}$/i.test(settings.background)) {
    next.background = settings.background;
  }
  for (const key of ["brightness", "contrast", "saturation"] as const) {
    if (typeof settings[key] === "number" && Number.isFinite(settings[key])) {
      next[key] = settings[key];
    }
  }
  if (typeof settings.rotation === "number" && Number.isFinite(settings.rotation)) {
    next.rotation = normalizeRotation(settings.rotation);
  }
  for (const key of [
    "grayscale",
    "sharpen",
    "trimWhite",
    "coverSingle",
    "preferEnhanced",
    "night",
    "lowMemory",
    "sideClickPaging",
    "centerClickControls",
    "doubleClickZoom",
    "ctrlWheelZoom",
    "wheelPageTurn",
    "dragPan",
  ] as const) {
    if (typeof settings[key] === "boolean") {
      next[key] = settings[key];
    }
  }
  return next;
}

function schedulePersistSettings(settings: ReaderSettings) {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void Promise.all(
      Object.entries(readerSettingKeys).map(([key, settingKey]) =>
        api.setSetting(settingKey, settings[key as keyof ReaderSettings]),
      ),
    ).catch((err) => {
      useToastStore.getState().push({
        title: t("readerSettingsSaveFailed"),
        description: formatUserError(err),
        tone: "error",
      });
    });
  }, 400);
}

function scheduleProgressSave(progress: PendingProgressSave) {
  pendingProgressSave = progress;
  window.clearTimeout(progressSaveTimer);
  progressSaveTimer = window.setTimeout(() => {
    void flushProgressSave();
  }, 350);
}

async function flushProgressSave(): Promise<void> {
  window.clearTimeout(progressSaveTimer);
  const progress = pendingProgressSave;
  pendingProgressSave = null;
  if (!progress) return;
  try {
    await api.saveProgress(
      progress.bookId,
      progress.currentPage,
      progress.totalPages,
      progress.mode,
      progress.direction,
    );
  } catch (err) {
    if (progress.attempts < 2) {
      pendingProgressSave ??= { ...progress, attempts: progress.attempts + 1 };
      progressSaveTimer = window.setTimeout(
        () => {
          void flushProgressSave();
        },
        750 * (progress.attempts + 1),
      );
      return;
    }
    useToastStore.getState().push({
      title: t("readerProgressSaveFailed"),
      description: formatUserError(err),
      tone: "error",
    });
  }
}

async function requestAndCommitPage(page: number, saveProgress: boolean): Promise<boolean> {
  const initial = useReaderStore.getState();
  const { book, pages, settings } = initial;
  if (!book || pages.length === 0) return false;
  const targetPage = pageStartForMode(page, pages.length, settings.mode, settings.coverSingle);
  const framePages =
    settings.mode === "scroll"
      ? [targetPage]
      : visiblePages(targetPage, pages.length, settings.mode, settings.coverSingle);
  const generation = ++navigationGeneration;
  const requestStartedAt = globalThis.performance.now();
  recordReaderPerformance("page-request", {
    bookId: book.id,
    requestedPage: targetPage,
    generation,
    mode: settings.mode,
    displayOrder: framePages.join(","),
  });
  useReaderStore.setState({
    requestedPage: targetPage,
    loadingPage: targetPage,
    requestGeneration: generation,
    error: null,
  });

  try {
    const frames = await Promise.all(
      framePages.map((pageIndex) => loadPageIntoCache(book.id, pageIndex, true)),
    );
    if (!isLatestNavigation(generation, book.id)) {
      recordReaderPerformance("stale-generation", { generation, stage: "decoded" });
      return false;
    }
    const paintTime = await nextPaint();
    recordReaderPerformance("raf-commit", {
      generation,
      requestedPage: targetPage,
      elapsedMs: paintTime - requestStartedAt,
    });
    if (!isLatestNavigation(generation, book.id)) {
      recordReaderPerformance("stale-generation", { generation, stage: "raf" });
      return false;
    }

    const beforeCommit = useReaderStore.getState();
    const oldFrames = beforeCommit.committedFrames;
    useReaderStore.setState({
      currentPage: targetPage,
      committedPage: targetPage,
      requestedPage: targetPage,
      loadingPage: null,
      committedFrames: frames,
      loading: false,
      error: null,
    });
    recordReaderPerformance("committed-page", {
      generation,
      committedPage: targetPage,
      durationMs: globalThis.performance.now() - requestStartedAt,
      frameCount: frames.length,
    });
    releaseFramesNoLongerReferenced(oldFrames);
    if (saveProgress) {
      const committed = useReaderStore.getState();
      scheduleProgressSave({
        bookId: book.id,
        currentPage: targetPage,
        totalPages: pages.length,
        mode: committed.settings.mode,
        direction: committed.settings.direction,
        attempts: 0,
      });
    }
    void preloadAround(targetPage);
    return true;
  } catch (error) {
    if (!isLatestNavigation(generation, book.id)) {
      recordReaderPerformance("stale-generation", { generation, stage: "error" });
      return false;
    }
    recordReaderPerformance("page-load-error", {
      generation,
      requestedPage: targetPage,
      message: error instanceof Error ? error.message : String(error),
    });
    useReaderStore.setState({
      loadingPage: null,
      loading: false,
      error: formatUserError(error),
    });
    return false;
  }
}

function isLatestNavigation(generation: number, bookId: number): boolean {
  const current = useReaderStore.getState();
  return (
    generation === navigationGeneration &&
    generation === current.requestGeneration &&
    current.book?.id === bookId
  );
}

async function preloadAround(pageIndex: number): Promise<void> {
  const { book, pages, settings } = useReaderStore.getState();
  if (!book) return;
  const indices = preloadIndices(pageIndex, pages.length, settings);
  await Promise.all(indices.map((index) => loadPageIntoCache(book.id, index, false))).catch(
    () => undefined,
  );
}

function preloadIndices(pageIndex: number, pageCount: number, settings: ReaderSettings): number[] {
  if (settings.mode === "scroll") {
    const radius = settings.lowMemory ? 3 : 5;
    return Array.from(
      { length: radius * 2 + 1 },
      (_, offset) => pageIndex - radius + offset,
    ).filter((index) => index >= 0 && index < pageCount);
  }
  if (settings.mode === "double") {
    const current = visiblePages(pageIndex, pageCount, "double", settings.coverSingle);
    const nextStart = nextPageForMode(pageIndex, pageCount, "double", settings.coverSingle);
    const previousStart = previousPageForMode(pageIndex, "double", settings.coverSingle);
    return [
      ...current,
      ...visiblePages(nextStart, pageCount, "double", settings.coverSingle),
      ...visiblePages(previousStart, pageCount, "double", settings.coverSingle),
    ].filter((index, position, all) => all.indexOf(index) === position);
  }
  return [pageIndex, pageIndex + 1, pageIndex - 1, pageIndex + 2].filter(
    (index, position, all) => index >= 0 && index < pageCount && all.indexOf(index) === position,
  );
}

async function loadPageIntoCache(
  bookId: number,
  pageIndex: number,
  priority: boolean,
): Promise<DecodedPageFrame> {
  const current = useReaderStore.getState();
  const book = current.book;
  if (!book || book.id !== bookId) throw new Error("reader session changed");
  const cacheKey = buildPageCacheKey(book, pageIndex, current.settings);
  const cached = current.pageCache.get(pageIndex);
  if (cached?.cacheKey === cacheKey) {
    recordReaderPerformance("preload-hit", { pageIndex, cacheKey, priority });
    const touchedCache = touchDecodedFrame(current.pageCache, pageIndex);
    useReaderStore.setState({ pageCache: touchedCache });
    recordReaderPerformance("cache-state", {
      entries: touchedCache.size,
      bytes: current.decodedCacheBytes,
      budgetBytes: decodedCacheBudget(current.settings.lowMemory),
    });
    return cached;
  }
  recordReaderPerformance("preload-miss", { pageIndex, cacheKey, priority });
  const loaderGeneration = pageLoadGeneration;
  const fallback = current.pages[pageIndex] ?? {
    width: null,
    height: null,
  };
  const frame = await getDecodedPage(
    bookId,
    pageIndex,
    priority,
    cacheKey,
    {
      trimWhite: current.settings.trimWhite,
      sharpen: current.settings.sharpen,
    },
    fallback,
  );
  if (loaderGeneration !== pageLoadGeneration) throw new Error("reader page loader reset");
  const latest = useReaderStore.getState();
  if (latest.book?.id !== bookId) throw new Error("reader session changed");
  if (buildPageCacheKey(latest.book, pageIndex, latest.settings) !== frame.cacheKey) {
    throw new Error("reader source selection changed");
  }
  const protectedPages = new Set([
    ...latest.committedFrames.map((item) => item.pageIndex),
    ...visiblePages(
      latest.requestedPage,
      latest.pages.length,
      latest.settings.mode,
      latest.settings.coverSingle,
    ),
  ]);
  const retained = retainDecodedFrame(latest.pageCache, pageIndex, frame, {
    budgetBytes: decodedCacheBudget(latest.settings.lowMemory),
    maxEntries: decodedCacheEntryLimit(latest.settings),
    protectedPages,
  });
  useReaderStore.setState({
    pageCache: retained.cache,
    decodedCacheBytes: retained.bytes,
  });
  retained.evicted.forEach(releaseFrameIfUnreferenced);
  recordReaderPerformance("cache-state", {
    entries: retained.cache.size,
    bytes: retained.bytes,
    budgetBytes: decodedCacheBudget(latest.settings.lowMemory),
  });
  return frame;
}

function getDecodedPage(
  bookId: number,
  pageIndex: number,
  priority: boolean,
  cacheKey: string,
  transforms: { trimWhite: boolean; sharpen: boolean },
  fallback: Pick<BookPage, "width" | "height">,
): Promise<DecodedPageFrame> {
  const key = cacheKey;
  const existing = pageRequests.get(key);
  if (existing) {
    if (priority && !existing.priority) {
      existing.priority = true;
      pageLoadQueue.sort(comparePageLoadRequest);
      drainPageLoadQueue();
    }
    return existing.promise;
  }

  let resolveRequest: (payload: DecodedPageFrame) => void = () => undefined;
  let rejectRequest: (error: unknown) => void = () => undefined;
  const promise = new Promise<DecodedPageFrame>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  void promise.catch(() => undefined);
  const request: PageLoadRequest = {
    key,
    cacheKey,
    bookId,
    pageIndex,
    priority,
    generation: pageLoadGeneration,
    transforms,
    fallback,
    promise,
    resolve: resolveRequest,
    reject: rejectRequest,
  };
  pageRequests.set(key, request);
  pageLoadQueue.push(request);
  pageLoadQueue.sort(comparePageLoadRequest);
  drainPageLoadQueue();
  return promise;
}

function drainPageLoadQueue(): void {
  while (activePageLoads < maxConcurrentPageLoads && pageLoadQueue.length > 0) {
    const requestIndex = pageLoadQueue.findIndex(
      (request) => request.priority || activeBackgroundPageLoads === 0,
    );
    if (requestIndex < 0) return;
    const [request] = pageLoadQueue.splice(requestIndex, 1);
    if (request.generation !== pageLoadGeneration) continue;
    const background = !request.priority;
    activePageLoads += 1;
    if (background) activeBackgroundPageLoads += 1;
    const materializeStartedAt = globalThis.performance.now();
    recordReaderPerformance("materialize-start", {
      bookId: request.bookId,
      pageIndex: request.pageIndex,
      cacheKey: request.cacheKey,
    });
    void api
      .getPageData(request.bookId, request.pageIndex, request.transforms)
      .then((payload) => {
        recordReaderPerformance("materialize-end", {
          bookId: request.bookId,
          pageIndex: request.pageIndex,
          durationMs: globalThis.performance.now() - materializeStartedAt,
        });
        recordReaderPerformance("asset-url-ready", {
          bookId: request.bookId,
          pageIndex: request.pageIndex,
        });
        return decodePagePayload(payload, request.cacheKey, request.fallback);
      })
      .then(request.resolve, request.reject)
      .finally(() => {
        if (request.generation !== pageLoadGeneration) return;
        activePageLoads -= 1;
        if (background) activeBackgroundPageLoads -= 1;
        pageRequests.delete(request.key);
        drainPageLoadQueue();
      });
  }
}

function comparePageLoadRequest(a: PageLoadRequest, b: PageLoadRequest): number {
  if (a.priority === b.priority) return 0;
  return a.priority ? -1 : 1;
}

function trimCacheToCurrentBudget(): void {
  const current = useReaderStore.getState();
  if (current.pageCache.size === 0) return;
  const protectedPages = new Set(current.committedFrames.map((frame) => frame.pageIndex));
  const newest = [...current.pageCache.entries()].at(-1);
  if (!newest) return;
  const retained = retainDecodedFrame(current.pageCache, newest[0], newest[1], {
    budgetBytes: decodedCacheBudget(current.settings.lowMemory),
    maxEntries: decodedCacheEntryLimit(current.settings),
    protectedPages,
  });
  useReaderStore.setState({
    pageCache: retained.cache,
    decodedCacheBytes: retained.bytes,
  });
  retained.evicted.forEach(releaseFrameIfUnreferenced);
}

function releaseFramesNoLongerReferenced(frames: Iterable<DecodedPageFrame>): void {
  for (const frame of frames) releaseFrameIfUnreferenced(frame);
}

function releaseFrameIfUnreferenced(frame: DecodedPageFrame): void {
  const current = useReaderStore.getState();
  if (current.committedFrames.includes(frame)) return;
  if ([...current.pageCache.values()].includes(frame)) return;
  releaseDecodedFrame(frame);
}

function releaseCurrentReaderResources(): void {
  const current = useReaderStore.getState();
  releaseDecodedFrames([...current.pageCache.values(), ...current.committedFrames]);
}
