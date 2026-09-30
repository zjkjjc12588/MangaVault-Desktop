import type { ReaderMode } from "../lib/types";

export interface ThumbnailWindow {
  start: number;
  end: number;
  loadBatchSize: number;
  cacheLimit: number;
}

export function retainLruEntry<K, V>(
  entries: Map<K, V>,
  key: K,
  value: V,
  limit: number,
): Map<K, V> {
  const next = new Map(entries);
  next.delete(key);
  next.set(key, value);
  while (next.size > Math.max(1, limit)) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.max(0, Math.min(page, pageCount - 1));
}

export function doublePageStart(page: number, pageCount: number, coverSingle: boolean): number {
  const clamped = clampPage(page, pageCount);
  if (!coverSingle) return clamped - (clamped % 2);
  if (clamped === 0) return 0;
  return clamped - ((clamped - 1) % 2);
}

export function pageStartForMode(
  page: number,
  pageCount: number,
  mode: ReaderMode,
  coverSingle = false,
): number {
  if (mode === "double") return doublePageStart(page, pageCount, coverSingle);
  return clampPage(page, pageCount);
}

export function nextPageForMode(
  current: number,
  pageCount: number,
  mode: ReaderMode,
  coverSingle = false,
): number {
  if (mode !== "double") return clampPage(current + 1, pageCount);
  const start = doublePageStart(current, pageCount, coverSingle);
  return clampPage(coverSingle && start === 0 ? 1 : start + 2, pageCount);
}

export function previousPageForMode(
  current: number,
  mode: ReaderMode,
  coverSingle = false,
): number {
  if (mode !== "double") return Math.max(0, current - 1);
  if (!coverSingle) return Math.max(0, current - 2);
  const start = doublePageStart(current, Number.MAX_SAFE_INTEGER, coverSingle);
  if (coverSingle && start <= 1) return 0;
  return Math.max(0, start - 2);
}

export function visiblePages(
  current: number,
  pageCount: number,
  mode: ReaderMode,
  coverSingle = false,
): number[] {
  if (mode === "scroll") {
    const radius = 6;
    const start = Math.max(0, current - radius);
    const end = Math.min(pageCount, current + radius + 1);
    return Array.from({ length: end - start }, (_, index) => start + index);
  }
  if (mode === "double") {
    const start = doublePageStart(current, pageCount, coverSingle);
    if (coverSingle && start === 0) return [0];
    return start + 1 < pageCount ? [start, start + 1] : [start];
  }
  return [clampPage(current, pageCount)];
}

export function visibleRangePage(startIndex: number, endIndex: number, pageCount: number): number {
  return clampPage(Math.floor((startIndex + endIndex) / 2), pageCount);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100;
  return Math.max(50, Math.min(Math.round(zoom), 250));
}

export function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  return (((Math.round(rotation / 90) % 4) + 4) % 4) * 90;
}

export function zoomFromWheel(current: number, deltaY: number): number {
  const step = deltaY < 0 ? 10 : -10;
  return clampZoom(current + step);
}

export function wheelPageTurnDirection(
  deltaX: number,
  deltaY: number,
  direction: "ltr" | "rtl",
): -1 | 0 | 1 {
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 24;
  if (horizontal) {
    const forward = direction === "rtl" ? deltaX < 0 : deltaX > 0;
    return forward ? 1 : -1;
  }
  if (Math.abs(deltaY) > 30) return deltaY > 0 ? 1 : -1;
  return 0;
}

export function canTriggerWheelPageTurn(
  lastTriggeredAt: number,
  now: number,
  minimumIntervalMs = 180,
): boolean {
  return now - lastTriggeredAt >= minimumIntervalMs;
}

export function scrollWindowShift(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  deltaY: number,
): -1 | 0 | 1 {
  if (Math.abs(deltaY) < 24 || clientHeight <= 0 || scrollHeight <= clientHeight) return 0;
  const edge = Math.max(96, clientHeight * 0.18);
  if (deltaY > 0 && scrollTop + clientHeight >= scrollHeight - edge) return 1;
  if (deltaY < 0 && scrollTop <= edge) return -1;
  return 0;
}

export function thumbnailWindow(
  currentPage: number,
  pageCount: number,
  lowMemory: boolean,
): ThumbnailWindow {
  const radius = lowMemory ? 4 : 8;
  return {
    start: Math.max(0, currentPage - radius),
    end: Math.min(pageCount, currentPage + radius + 1),
    loadBatchSize: lowMemory ? 3 : 6,
    cacheLimit: lowMemory ? 24 : 48,
  };
}
