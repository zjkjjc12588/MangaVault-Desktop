import { describe, expect, it, vi } from "vitest";
import type { Book, ReaderSettings } from "../lib/types";
import {
  buildPageCacheKey,
  decodedCacheBudget,
  releaseDecodedFrame,
  retainDecodedFrame,
  type DecodedPageFrame,
} from "../reader/readerPageCache";

const book: Pick<Book, "id" | "updatedAt" | "modifiedAt"> = {
  id: 7,
  updatedAt: "2026-07-14T00:00:00Z",
  modifiedAt: "2026-07-13T00:00:00Z",
};

const sourceSettings: Pick<ReaderSettings, "preferEnhanced" | "trimWhite" | "sharpen"> = {
  preferEnhanced: true,
  trimWhite: false,
  sharpen: false,
};

describe("decoded reader page cache", () => {
  it("keys pages by source version, enhancement preference, and content transforms", () => {
    const enhanced = buildPageCacheKey(book, 3, sourceSettings);
    const original = buildPageCacheKey(book, 3, {
      ...sourceSettings,
      preferEnhanced: false,
    });
    const transformed = buildPageCacheKey(book, 3, {
      ...sourceSettings,
      trimWhite: true,
      sharpen: true,
    });

    expect(enhanced).not.toBe(original);
    expect(enhanced).not.toBe(transformed);
    expect(enhanced).toContain("enhanced");
    expect(original).toContain("original");
  });

  it("evicts by decoded byte budget instead of entry count", () => {
    const first = frame(0, 70);
    const second = frame(1, 70);
    const initial = retainDecodedFrame(new Map(), 0, first, {
      budgetBytes: 100,
      maxEntries: 10,
      protectedPages: new Set([0]),
    });
    const next = retainDecodedFrame(initial.cache, 1, second, {
      budgetBytes: 100,
      maxEntries: 10,
      protectedPages: new Set([1]),
    });

    expect(next.cache.has(0)).toBe(false);
    expect(next.cache.get(1)).toBe(second);
    expect(next.bytes).toBe(70);
    expect(next.evicted).toContain(first);
  });

  it("never evicts committed or incoming protected pages", () => {
    const committed = frame(4, 80);
    const incoming = frame(5, 80);
    const initial = new Map([[4, committed]]);
    const next = retainDecodedFrame(initial, 5, incoming, {
      budgetBytes: 100,
      maxEntries: 1,
      protectedPages: new Set([4, 5]),
    });

    expect(next.cache.get(4)).toBe(committed);
    expect(next.cache.get(5)).toBe(incoming);
    expect(next.bytes).toBe(160);
  });

  it("uses the requested normal and low-memory byte budgets", () => {
    expect(decodedCacheBudget(false)).toBe(256 * 1024 * 1024);
    expect(decodedCacheBudget(true)).toBe(96 * 1024 * 1024);
  });

  it("releases owned object URLs only when explicitly evicted from all references", () => {
    const original = globalThis.URL.revokeObjectURL;
    const revoke = vi.fn();
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: revoke,
    });
    const owned = { ...frame(2, 64), dataUrl: "blob:reader-page", ownsObjectUrl: true };

    expect(revoke).not.toHaveBeenCalled();
    releaseDecodedFrame(owned);
    expect(revoke).toHaveBeenCalledWith("blob:reader-page");
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: original,
    });
  });
});

function frame(pageIndex: number, decodedBytes: number): DecodedPageFrame {
  return {
    pageIndex,
    mimeType: "image/png",
    dataUrl: `data:${pageIndex}`,
    filePath: null,
    cacheKey: `key:${pageIndex}`,
    width: 1,
    height: 1,
    decodedBytes,
    ownsObjectUrl: false,
  };
}
