export type ReaderPerformanceEventName =
  | "page-request"
  | "materialize-start"
  | "materialize-end"
  | "asset-url-ready"
  | "decode-start"
  | "decode-end"
  | "raf-commit"
  | "committed-page"
  | "preload-hit"
  | "preload-miss"
  | "cache-state"
  | "stale-generation"
  | "page-load-error";

export interface ReaderPerformanceEvent {
  name: ReaderPerformanceEventName;
  at: number;
  detail: Record<string, string | number | boolean | null>;
}

export interface ReaderPerformanceSummary {
  sampleCount: number;
  commitP50Ms: number | null;
  commitP95Ms: number | null;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number | null;
  cacheBytes: number;
  staleGenerations: number;
}

const events: ReaderPerformanceEvent[] = [];
let enabled = readInitialState();

export function setReaderPerformanceEnabled(next: boolean): void {
  enabled = next;
  if (!next) events.splice(0);
}

export function readerPerformanceEnabled(): boolean {
  return enabled;
}

export function recordReaderPerformance(
  name: ReaderPerformanceEventName,
  detail: Record<string, string | number | boolean | null> = {},
): void {
  if (!enabled) return;
  events.push({ name, at: globalThis.performance.now(), detail });
  if (events.length > 2_000) events.splice(0, events.length - 2_000);
}

export function readerPerformanceSnapshot(): ReaderPerformanceEvent[] {
  return events.map((event) => ({ ...event, detail: { ...event.detail } }));
}

export function readerPerformanceSummary(): ReaderPerformanceSummary {
  const requests = new Map<number, number>();
  const commitDurations: number[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let cacheBytes = 0;
  let staleGenerations = 0;

  for (const event of events) {
    if (event.name === "page-request" && typeof event.detail.generation === "number") {
      requests.set(event.detail.generation, event.at);
    }
    if (event.name === "committed-page" && typeof event.detail.generation === "number") {
      const startedAt = requests.get(event.detail.generation);
      if (startedAt !== undefined) commitDurations.push(event.at - startedAt);
    }
    if (event.name === "preload-hit") cacheHits += 1;
    if (event.name === "preload-miss") cacheMisses += 1;
    if (event.name === "cache-state" && typeof event.detail.bytes === "number") {
      cacheBytes = event.detail.bytes;
    }
    if (event.name === "stale-generation") staleGenerations += 1;
  }

  const cacheSamples = cacheHits + cacheMisses;
  return {
    sampleCount: commitDurations.length,
    commitP50Ms: percentile(commitDurations, 0.5),
    commitP95Ms: percentile(commitDurations, 0.95),
    cacheHits,
    cacheMisses,
    cacheHitRate: cacheSamples ? cacheHits / cacheSamples : null,
    cacheBytes,
    staleGenerations,
  };
}

export function resetReaderPerformance(): void {
  events.splice(0);
}

function readInitialState(): boolean {
  try {
    return window.localStorage.getItem("mangavault.reader.performance") === "1";
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    __MANGAVAULT_READER_PERFORMANCE__?: {
      snapshot: () => ReaderPerformanceEvent[];
      summary: () => ReaderPerformanceSummary;
      reset: () => void;
      setEnabled: (enabled: boolean) => void;
    };
  }
}

if (typeof window !== "undefined") {
  window.__MANGAVAULT_READER_PERFORMANCE__ = {
    snapshot: readerPerformanceSnapshot,
    summary: readerPerformanceSummary,
    reset: resetReaderPerformance,
    setEnabled: setReaderPerformanceEnabled,
  };
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((sorted.length - 1) * ratio)];
}
