import { describe, expect, it } from "vitest";
import {
  canTriggerWheelPageTurn,
  clampPage,
  clampZoom,
  doublePageStart,
  nextPageForMode,
  normalizeRotation,
  pageStartForMode,
  previousPageForMode,
  retainLruEntry,
  scrollWindowShift,
  thumbnailWindow,
  visibleRangePage,
  visiblePages,
  wheelPageTurnDirection,
  zoomFromWheel,
} from "../reader/readerCore";

describe("reader core", () => {
  it("clamps pages", () => {
    expect(clampPage(-1, 10)).toBe(0);
    expect(clampPage(99, 10)).toBe(9);
  });

  it("steps correctly in single and double page modes", () => {
    expect(nextPageForMode(0, 10, "single")).toBe(1);
    expect(nextPageForMode(0, 10, "double")).toBe(2);
    expect(previousPageForMode(2, "double")).toBe(0);
    expect(doublePageStart(2, 10, true)).toBe(1);
    expect(visiblePages(2, 10, "double", true)).toEqual([1, 2]);
    expect(visiblePages(0, 10, "double", true)).toEqual([0]);
    expect(nextPageForMode(0, 10, "double", true)).toBe(1);
    expect(previousPageForMode(1, "double", true)).toBe(0);
    expect(pageStartForMode(1, 10, "double")).toBe(0);
    expect(pageStartForMode(2, 10, "double", true)).toBe(1);
    expect(visiblePages(1, 10, "double")).toEqual([0, 1]);
    expect(nextPageForMode(1, 10, "double")).toBe(2);
  });

  it("returns visible page windows", () => {
    expect(visiblePages(0, 3, "single")).toEqual([0]);
    expect(visiblePages(0, 3, "double")).toEqual([0, 1]);
    expect(visiblePages(0, 3, "scroll")).toEqual([0, 1, 2]);
    expect(visiblePages(50, 200, "scroll")).toHaveLength(13);
    expect(visiblePages(50, 200, "scroll")).toEqual([
      44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
    ]);
  });

  it("clamps zoom and maps pinch wheel deltas", () => {
    expect(clampZoom(20)).toBe(50);
    expect(clampZoom(260)).toBe(250);
    expect(clampZoom(Number.NaN)).toBe(100);
    expect(zoomFromWheel(100, -1)).toBe(110);
    expect(zoomFromWheel(100, 1)).toBe(90);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });

  it("maps wheel input and throttles repeated paged turns", () => {
    expect(wheelPageTurnDirection(0, 40, "ltr")).toBe(1);
    expect(wheelPageTurnDirection(0, -40, "rtl")).toBe(-1);
    expect(wheelPageTurnDirection(48, 2, "ltr")).toBe(1);
    expect(wheelPageTurnDirection(48, 2, "rtl")).toBe(-1);
    expect(wheelPageTurnDirection(8, 8, "ltr")).toBe(0);
    expect(canTriggerWheelPageTurn(100, 279)).toBe(false);
    expect(canTriggerWheelPageTurn(100, 280)).toBe(true);
  });

  it("advances scroll windows near continuous scroll edges", () => {
    expect(scrollWindowShift(900, 500, 1400, 40)).toBe(1);
    expect(scrollWindowShift(10, 500, 1400, -40)).toBe(-1);
    expect(scrollWindowShift(400, 500, 1400, 40)).toBe(0);
    expect(scrollWindowShift(900, 500, 1400, 5)).toBe(0);
    expect(scrollWindowShift(0, 500, 500, 40)).toBe(0);
  });

  it("maps a virtual continuous-scroll viewport to a stable progress page", () => {
    expect(visibleRangePage(8, 12, 100)).toBe(10);
    expect(visibleRangePage(-4, 2, 100)).toBe(0);
    expect(visibleRangePage(98, 140, 100)).toBe(99);
  });

  it("shrinks thumbnail navigation work in low memory mode", () => {
    expect(thumbnailWindow(20, 100, false)).toEqual({
      start: 12,
      end: 29,
      loadBatchSize: 6,
      cacheLimit: 48,
    });
    expect(thumbnailWindow(20, 100, true)).toEqual({
      start: 16,
      end: 25,
      loadBatchSize: 3,
      cacheLimit: 24,
    });
    expect(thumbnailWindow(1, 4, true)).toMatchObject({ start: 0, end: 4 });
  });

  it("retains recently accessed entries when an LRU cache reaches its limit", () => {
    const initial = new Map([
      [0, "zero"],
      [1, "one"],
      [2, "two"],
    ]);
    const touched = retainLruEntry(initial, 0, "zero", 3);
    const next = retainLruEntry(touched, 3, "three", 3);

    expect([...next.keys()]).toEqual([2, 0, 3]);
    expect(next.has(1)).toBe(false);
  });
});
