import { create } from "zustand";
import * as api from "../lib/api";
import type { RecentReadingItem } from "../lib/types";
import {
  createRecentReadingQuery,
  defaultRecentReadingPreferences,
  normalizeRecentReadingPreferences,
  type RecentReadingPreferences,
} from "../recent/recentReading";

interface RecentReadingState extends RecentReadingPreferences {
  items: RecentReadingItem[];
  total: number;
  search: string;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
  error: string | null;
  scrollIndex: number;
  generation: number;
  syncSettings: (settings: Record<string, unknown>) => void;
  setSearch: (search: string) => void;
  setPreferences: (preferences: Partial<RecentReadingPreferences>) => void;
  setScrollIndex: (index: number) => void;
  load: (reset?: boolean) => Promise<void>;
  removeLocal: (bookId: number) => void;
  updateProgressLocal: (bookId: number, currentPage: number, percent: number) => void;
  clearLocal: () => void;
}

export const useRecentStore = create<RecentReadingState>((set, get) => ({
  ...defaultRecentReadingPreferences,
  items: [],
  total: 0,
  search: "",
  loading: false,
  loadingMore: false,
  loaded: false,
  error: null,
  scrollIndex: 0,
  generation: 0,
  syncSettings: (settings) => set(normalizeRecentReadingPreferences(settings)),
  setSearch: (search) => set({ search, scrollIndex: 0 }),
  setPreferences: (preferences) => set({ ...preferences, scrollIndex: 0 }),
  setScrollIndex: (scrollIndex) => set({ scrollIndex: Math.max(0, scrollIndex) }),
  load: async (reset = true) => {
    const current = get();
    if (!reset && (current.loadingMore || current.items.length >= current.total)) return;
    const generation = current.generation + 1;
    const offset = reset ? 0 : current.items.length;
    set({
      generation,
      loading: reset,
      loadingMore: !reset,
      error: null,
    });
    try {
      const page = await api.listRecentReading(
        createRecentReadingQuery(get(), get().search, offset),
      );
      if (get().generation !== generation) return;
      set((state) => ({
        items: reset ? page.items : mergeRecentItems(state.items, page.items),
        total: page.total,
        loading: false,
        loadingMore: false,
        loaded: true,
      }));
    } catch (error) {
      if (get().generation !== generation) return;
      set({
        loading: false,
        loadingMore: false,
        loaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  removeLocal: (bookId) =>
    set((state) => ({
      items: state.items.filter((item) => item.book.id !== bookId),
      total: Math.max(0, state.total - 1),
    })),
  updateProgressLocal: (bookId, currentPage, progressPercent) =>
    set((state) => {
      const updated = state.items.map((item) =>
        item.book.id === bookId
          ? {
              ...item,
              currentPage,
              progressPercent,
              isFinished: progressPercent >= 0.999,
              book: { ...item.book, progressPercent },
            }
          : item,
      );
      const visible = updated.filter((item) => matchesProgressFilter(item, state.filter));
      return {
        items: sortRecentItems(visible, state.sort),
        total: Math.max(0, state.total - (updated.length - visible.length)),
      };
    }),
  clearLocal: () => set({ items: [], total: 0, scrollIndex: 0 }),
}));

function mergeRecentItems(
  current: RecentReadingItem[],
  incoming: RecentReadingItem[],
): RecentReadingItem[] {
  const ids = new Set(current.map((item) => item.book.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.book.id))];
}

function matchesProgressFilter(
  item: RecentReadingItem,
  filter: RecentReadingPreferences["filter"],
): boolean {
  if (filter === "finished") return item.isFinished;
  if (filter === "unfinished") return !item.isFinished;
  return true;
}

function sortRecentItems(
  items: RecentReadingItem[],
  sort: RecentReadingPreferences["sort"],
): RecentReadingItem[] {
  if (sort === "progress") {
    return [...items].sort(
      (left, right) =>
        right.progressPercent - left.progressPercent ||
        right.lastReadAt.localeCompare(left.lastReadAt),
    );
  }
  if (sort === "title") {
    return [...items].sort((left, right) => left.book.title.localeCompare(right.book.title));
  }
  return [...items].sort((left, right) => right.lastReadAt.localeCompare(left.lastReadAt));
}
