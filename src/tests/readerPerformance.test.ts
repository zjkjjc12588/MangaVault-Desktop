import { beforeEach, describe, expect, it } from "vitest";
import {
  readerPerformanceSummary,
  recordReaderPerformance,
  resetReaderPerformance,
  setReaderPerformanceEnabled,
} from "../reader/readerPerformance";

describe("reader performance diagnostics", () => {
  beforeEach(() => {
    setReaderPerformanceEnabled(true);
    resetReaderPerformance();
  });

  it("summarizes commits, cache activity, bytes, and stale generations", () => {
    recordReaderPerformance("page-request", { generation: 1 });
    recordReaderPerformance("preload-hit", { pageIndex: 1 });
    recordReaderPerformance("preload-miss", { pageIndex: 2 });
    recordReaderPerformance("cache-state", { bytes: 4096 });
    recordReaderPerformance("stale-generation", { generation: 0 });
    recordReaderPerformance("committed-page", { generation: 1 });

    const summary = readerPerformanceSummary();
    expect(summary.sampleCount).toBe(1);
    expect(summary.commitP50Ms).not.toBeNull();
    expect(summary.commitP95Ms).toBe(summary.commitP50Ms);
    expect(summary.cacheHitRate).toBe(0.5);
    expect(summary.cacheBytes).toBe(4096);
    expect(summary.staleGenerations).toBe(1);
  });
});
