import type {
  RecentReadingFilter,
  RecentReadingQuery,
  RecentReadingSort,
  RecentReadingView,
} from "../lib/types";

export const RECENT_VIEW_KEY = "recent.view";
export const RECENT_SORT_KEY = "recent.sort";
export const RECENT_FILTER_KEY = "recent.filter";
export const RECENT_PAGE_SIZE = 80;

export interface RecentReadingPreferences {
  view: RecentReadingView;
  sort: RecentReadingSort;
  filter: RecentReadingFilter;
}

export const defaultRecentReadingPreferences: RecentReadingPreferences = {
  view: "list",
  sort: "recent",
  filter: "all",
};

export function normalizeRecentReadingPreferences(
  settings: Record<string, unknown>,
): RecentReadingPreferences {
  return {
    view: settings[RECENT_VIEW_KEY] === "grid" ? "grid" : "list",
    sort: isSort(settings[RECENT_SORT_KEY]) ? settings[RECENT_SORT_KEY] : "recent",
    filter: isFilter(settings[RECENT_FILTER_KEY]) ? settings[RECENT_FILTER_KEY] : "all",
  };
}

export function createRecentReadingQuery(
  preferences: RecentReadingPreferences,
  search: string,
  offset = 0,
): RecentReadingQuery {
  return {
    search: search.trim() || undefined,
    filter: preferences.filter,
    sort: preferences.sort,
    limit: RECENT_PAGE_SIZE,
    offset: Math.max(0, offset),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  };
}

function isSort(value: unknown): value is RecentReadingSort {
  return value === "recent" || value === "progress" || value === "title";
}

function isFilter(value: unknown): value is RecentReadingFilter {
  return ["all", "unfinished", "finished", "today", "7days", "30days"].includes(String(value));
}
