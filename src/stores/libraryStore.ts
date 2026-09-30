import { create } from "zustand";
import * as api from "../lib/api";
import { formatUserError, t } from "../lib/i18n";
import type { ImportJobResult } from "../lib/api";
import type { Book, BookQuery, LibraryView, MetadataUpdate, ScanJob } from "../lib/types";
import { useToastStore } from "./toastStore";

export const LIBRARY_PAGE_SIZE = 240;
export const SCAN_RUNNING_LIBRARY_REFRESH_MS = 5_000;
export const SCAN_RUNNING_LIVE_BOOK_REFRESH_LIMIT = 2_000;

let lastRunningLibraryRefreshAt = 0;
let lastRunningScanProgress = -1;
let libraryLoadGeneration = 0;

export function __resetLibraryRunningRefreshForTests(): void {
  lastRunningLibraryRefreshAt = 0;
  lastRunningScanProgress = -1;
  libraryLoadGeneration = 0;
}

interface LibraryState {
  books: Book[];
  tags: string[];
  categories: string[];
  authors: string[];
  formats: string[];
  jobs: ScanJob[];
  selectedBookId: number | null;
  query: BookQuery;
  view: LibraryView;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  importFolder: (path?: string) => Promise<void>;
  importFiles: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<ImportJobResult[]>;
  setQuery: (query: Partial<BookQuery>) => Promise<void>;
  setView: (view: LibraryView) => Promise<void>;
  selectBook: (id: number | null) => void;
  toggleFavorite: (id: number) => Promise<void>;
  setRating: (id: number, rating: number) => Promise<void>;
  updateMetadata: (id: number, update: MetadataUpdate) => Promise<void>;
  setTags: (id: number, tags: string[]) => Promise<void>;
  refreshJobs: () => Promise<void>;
  cancelScan: (jobId: number) => Promise<void>;
  retryScan: (jobId: number) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  tags: [],
  categories: [],
  authors: [],
  formats: [],
  jobs: [],
  selectedBookId: null,
  query: { sort: "title", limit: LIBRARY_PAGE_SIZE, offset: 0 },
  view: "grid",
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null,
  async load() {
    const generation = nextLibraryLoadGeneration();
    const query = get().query;
    set({ loading: true, loadingMore: false, error: null });
    try {
      const [page, tags, categories, authors, formats, jobs] = await Promise.all([
        api.listBooks(pageRequest(query, 0)),
        api.listTags(),
        api.listCategories(),
        api.listAuthors(),
        api.listFormats(),
        api.listScanJobs(),
      ]);
      if (!isCurrentLibraryLoad(generation)) return;
      const { books, hasMore } = unpackPage(page, query);
      set({ books, hasMore, tags, categories, authors, formats, jobs, loading: false });
    } catch (err) {
      if (!isCurrentLibraryLoad(generation)) return;
      set({ error: formatUserError(err), loading: false, loadingMore: false });
    }
  },
  async loadMore() {
    const state = get();
    if (state.loading || state.loadingMore || !state.hasMore) return;
    const generation = libraryLoadGeneration;
    const query = state.query;
    const signature = bookQuerySignature(query);
    const offset = state.books.length;
    set({ loadingMore: true, error: null });
    try {
      const page = await api.listBooks(pageRequest(query, offset));
      if (
        !isCurrentLibraryLoad(generation) ||
        signature !== bookQuerySignature(get().query) ||
        get().books.length !== offset
      ) {
        return;
      }
      const { books, hasMore } = unpackPage(page, query);
      set({ books: [...get().books, ...books], hasMore, loadingMore: false });
    } catch (err) {
      if (!isCurrentLibraryLoad(generation)) return;
      set({ error: formatUserError(err), loadingMore: false });
    }
  },
  async importFolder(path) {
    set({ error: null });
    try {
      const rootPath = path ?? (await api.chooseImportFolder());
      if (!rootPath) return;
      await api.importFolder(rootPath, true);
      const jobs = await api.listScanJobs();
      set({ jobs });
      useToastStore.getState().push({
        title: t("scanStarted"),
        description: rootPath,
        tone: "info",
      });
    } catch (err) {
      set({ error: formatUserError(err) });
      useToastStore.getState().push({
        title: t("importFailed"),
        description: formatUserError(err),
        tone: "error",
      });
    }
  },
  async importFiles() {
    set({ error: null });
    try {
      const paths = await api.chooseImportFiles();
      if (!paths?.length) return;
      await api.importPaths(paths, true);
      const jobs = await api.listScanJobs();
      set({ jobs });
      useToastStore.getState().push({
        title: t("fileScanStarted"),
        description: `${paths.length} ${t("selectedFiles")}`,
        tone: "info",
      });
    } catch (err) {
      set({ error: formatUserError(err) });
      useToastStore.getState().push({
        title: t("fileImportFailed"),
        description: formatUserError(err),
        tone: "error",
      });
    }
  },
  async importPaths(paths) {
    const candidates = paths.filter(Boolean);
    if (candidates.length === 0) return [];
    set({ error: null });
    try {
      const results = await api.importPaths(candidates, true);
      const jobs = await api.listScanJobs();
      set({ jobs });
      useToastStore.getState().push({
        title: t("scanStarted"),
        description: `${candidates.length} ${t("selectedPaths")}`,
        tone: "info",
      });
      return results;
    } catch (err) {
      set({ error: formatUserError(err) });
      useToastStore.getState().push({
        title: t("importFailed"),
        description: formatUserError(err),
        tone: "error",
      });
      return [];
    }
  },
  async setQuery(query) {
    set({ query: { ...get().query, ...query, offset: 0 } });
    await get().load();
  },
  async setView(view) {
    const queryView = view === "series" ? "series" : undefined;
    if (get().view === view && get().query.view === queryView) return;
    set({ view, query: { ...get().query, view: queryView, offset: 0 } });
    await get().load();
  },
  selectBook(id) {
    set({ selectedBookId: id });
  },
  async toggleFavorite(id) {
    const updated = await api.toggleFavorite(id);
    set({ books: get().books.map((book) => (book.id === id ? updated : book)) });
  },
  async setRating(id, rating) {
    const updated = await api.setRating(id, rating);
    set({ books: get().books.map((book) => (book.id === id ? updated : book)) });
  },
  async updateMetadata(id, update) {
    try {
      const updated = await api.updateBookMetadata(id, update);
      set({
        books: get().books.map((book) => (book.id === id ? updated : book)),
        authors: mergeAuthors(get().authors, updated.author),
      });
      useToastStore.getState().push({ title: t("metadataSaved"), tone: "success" });
    } catch (err) {
      const message = formatUserError(err);
      set({ error: message });
      useToastStore.getState().push({
        title: t("metadataSaveFailed"),
        description: message,
        tone: "error",
      });
      throw err;
    }
  },
  async setTags(id, tags) {
    const updatedTags = await api.setBookTags(id, tags);
    set({
      books: get().books.map((book) => (book.id === id ? { ...book, tags: updatedTags } : book)),
      tags: Array.from(new Set([...get().tags, ...updatedTags])).sort(),
    });
    useToastStore.getState().push({ title: t("tagsUpdated"), tone: "success" });
  },
  async refreshJobs() {
    try {
      const previousRunning = get().jobs.some((job) =>
        ["queued", "running", "cancelling"].includes(job.status),
      );
      const jobs = await api.listScanJobs();
      const running = jobs.some((job) => ["queued", "running", "cancelling"].includes(job.status));
      if (!previousRunning && running) {
        lastRunningLibraryRefreshAt = 0;
        lastRunningScanProgress = -1;
      }
      const progress = runningScanProgress(jobs);
      const now = Date.now();
      const liveBookRefreshAllowed =
        !isUnfilteredLibraryQuery(get().query) ||
        Math.max(progress, get().books.length) <= SCAN_RUNNING_LIVE_BOOK_REFRESH_LIMIT;
      const shouldRefreshBooks =
        running &&
        liveBookRefreshAllowed &&
        progress !== lastRunningScanProgress &&
        now - lastRunningLibraryRefreshAt >= SCAN_RUNNING_LIBRARY_REFRESH_MS;

      if (shouldRefreshBooks) {
        const generation = nextLibraryLoadGeneration();
        const query = get().query;
        const signature = bookQuerySignature(query);
        set({ loadingMore: false });
        const [page, tags, categories, authors, formats] = await Promise.all([
          api.listBooks(pageRequest(query, 0)),
          api.listTags(),
          api.listCategories(),
          api.listAuthors(),
          api.listFormats(),
        ]);
        lastRunningLibraryRefreshAt = now;
        lastRunningScanProgress = progress;
        if (isCurrentLibraryLoad(generation) && signature === bookQuerySignature(get().query)) {
          const { books, hasMore } = unpackPage(page, query);
          set({ jobs, books, hasMore, tags, categories, authors, formats, error: null });
        } else {
          set({ jobs });
        }
      } else {
        set({ jobs });
      }
      if (previousRunning && !running) {
        __resetLibraryRunningRefreshForTests();
        await get().load();
      }
    } catch (err) {
      set({ error: formatUserError(err) });
    }
  },
  async cancelScan(jobId) {
    await api.cancelScan(jobId);
    await get().refreshJobs();
    useToastStore.getState().push({ title: t("scanCancellationRequested"), tone: "info" });
  },
  async retryScan(jobId) {
    try {
      await api.retryScan(jobId);
      await get().refreshJobs();
      useToastStore.getState().push({ title: t("scanStarted"), tone: "info" });
    } catch (err) {
      set({ error: formatUserError(err) });
      useToastStore.getState().push({
        title: t("scanFailed"),
        description: formatUserError(err),
        tone: "error",
      });
    }
  },
}));

function mergeAuthors(authors: string[], author?: string | null): string[] {
  const trimmed = author?.trim();
  if (!trimmed) return authors;
  return Array.from(new Set([...authors, trimmed])).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );
}

function runningScanProgress(jobs: ScanJob[]): number {
  return jobs
    .filter((job) => ["queued", "running", "cancelling"].includes(job.status))
    .reduce((sum, job) => sum + job.importedCount + job.failedCount, 0);
}

function isUnfilteredLibraryQuery(query: BookQuery): boolean {
  return [
    query.search,
    query.author,
    query.tag,
    query.category,
    query.format,
    query.status,
    query.favorite,
    query.minRating,
    query.duplicatesOnly,
  ].every((value) => value === undefined || value === null || value === "");
}

function nextLibraryLoadGeneration(): number {
  libraryLoadGeneration += 1;
  return libraryLoadGeneration;
}

function isCurrentLibraryLoad(generation: number): boolean {
  return generation === libraryLoadGeneration;
}

function bookQuerySignature(query: BookQuery): string {
  return JSON.stringify({
    author: query.author ?? null,
    duplicatesOnly: query.duplicatesOnly ?? null,
    favorite: query.favorite ?? null,
    format: query.format ?? null,
    limit: query.limit ?? null,
    minRating: query.minRating ?? null,
    offset: query.offset ?? null,
    search: query.search ?? null,
    sort: query.sort ?? null,
    status: query.status ?? null,
    tag: query.tag ?? null,
    category: query.category ?? null,
    view: query.view ?? null,
  });
}

function pageRequest(query: BookQuery, offset: number): BookQuery {
  return {
    ...query,
    limit: pageSize(query) + 1,
    offset,
  };
}

function unpackPage(page: Book[], query: BookQuery): { books: Book[]; hasMore: boolean } {
  const limit = pageSize(query);
  return {
    books: page.slice(0, limit),
    hasMore: page.length > limit,
  };
}

function pageSize(query: BookQuery): number {
  return Math.max(1, query.limit ?? LIBRARY_PAGE_SIZE);
}
