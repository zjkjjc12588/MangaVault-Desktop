import type { Book, BookPage, PagePayload, ReaderSettings } from "../lib/types";
import { recordReaderPerformance } from "./readerPerformance";

export interface DecodedPageFrame extends PagePayload {
  cacheKey: string;
  width: number;
  height: number;
  decodedBytes: number;
  ownsObjectUrl: boolean;
}

export interface DecodedCacheResult {
  cache: Map<number, DecodedPageFrame>;
  bytes: number;
  evicted: DecodedPageFrame[];
}

const DECODED_PIXEL_OVERHEAD = 1.1;

export function decodedCacheBudget(lowMemory: boolean): number {
  return (lowMemory ? 96 : 256) * 1024 * 1024;
}

export function decodedCacheEntryLimit(settings: ReaderSettings): number {
  if (settings.mode === "scroll") return settings.lowMemory ? 8 : 12;
  if (settings.mode === "double") return settings.lowMemory ? 4 : 6;
  return settings.lowMemory ? 3 : 4;
}

export function buildPageCacheKey(
  book: Pick<Book, "id" | "updatedAt" | "modifiedAt">,
  pageIndex: number,
  settings: Pick<ReaderSettings, "preferEnhanced" | "trimWhite" | "sharpen">,
): string {
  const sourceVersion = book.updatedAt || book.modifiedAt || "unknown";
  return [
    book.id,
    pageIndex,
    sourceVersion,
    settings.preferEnhanced ? "enhanced" : "original",
    settings.trimWhite ? "trim" : "untrimmed",
    settings.sharpen ? "sharp" : "plain",
  ].join(":");
}

export async function decodePagePayload(
  payload: PagePayload,
  cacheKey: string,
  fallback: Pick<BookPage, "width" | "height"> | undefined,
): Promise<DecodedPageFrame> {
  const decodeStartedAt = globalThis.performance.now();
  recordReaderPerformance("decode-start", { pageIndex: payload.pageIndex, cacheKey });
  const dimensions = await decodeImageSource(payload.dataUrl, fallback);
  const decodedBytes = estimateDecodedBytes(dimensions.width, dimensions.height);
  recordReaderPerformance("decode-end", {
    pageIndex: payload.pageIndex,
    cacheKey,
    durationMs: globalThis.performance.now() - decodeStartedAt,
    decodedBytes,
  });
  return {
    ...payload,
    cacheKey,
    width: dimensions.width,
    height: dimensions.height,
    decodedBytes,
    ownsObjectUrl: payload.dataUrl.startsWith("blob:"),
  };
}

export function retainDecodedFrame(
  entries: Map<number, DecodedPageFrame>,
  pageIndex: number,
  frame: DecodedPageFrame,
  options: {
    budgetBytes: number;
    maxEntries: number;
    protectedPages: ReadonlySet<number>;
  },
): DecodedCacheResult {
  const next = new Map(entries);
  const evicted: DecodedPageFrame[] = [];
  const replaced = next.get(pageIndex);
  next.delete(pageIndex);
  next.set(pageIndex, frame);
  if (replaced && replaced !== frame) evicted.push(replaced);

  let bytes = decodedCacheBytes(next);
  while (next.size > options.maxEntries || bytes > options.budgetBytes) {
    const candidate = [...next.entries()].find(([key]) => !options.protectedPages.has(key));
    if (!candidate) break;
    next.delete(candidate[0]);
    evicted.push(candidate[1]);
    bytes -= candidate[1].decodedBytes;
  }
  return { cache: next, bytes: Math.max(0, bytes), evicted };
}

export function touchDecodedFrame(
  entries: Map<number, DecodedPageFrame>,
  pageIndex: number,
): Map<number, DecodedPageFrame> {
  const frame = entries.get(pageIndex);
  if (!frame) return entries;
  const next = new Map(entries);
  next.delete(pageIndex);
  next.set(pageIndex, frame);
  return next;
}

export function decodedCacheBytes(entries: Map<number, DecodedPageFrame>): number {
  let bytes = 0;
  for (const frame of entries.values()) bytes += frame.decodedBytes;
  return bytes;
}

export function releaseDecodedFrame(frame: DecodedPageFrame): void {
  if (frame.ownsObjectUrl && frame.dataUrl.startsWith("blob:")) {
    globalThis.URL.revokeObjectURL(frame.dataUrl);
  }
}

export function releaseDecodedFrames(frames: Iterable<DecodedPageFrame>): void {
  const released = new Set<string>();
  for (const frame of frames) {
    if (released.has(frame.dataUrl)) continue;
    released.add(frame.dataUrl);
    releaseDecodedFrame(frame);
  }
}

export function nextPaint(): Promise<number> {
  if (
    typeof globalThis.requestAnimationFrame !== "function" ||
    navigator.userAgent.toLowerCase().includes("jsdom")
  ) {
    return Promise.resolve(globalThis.performance.now());
  }
  return new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
}

function estimateDecodedBytes(width: number, height: number): number {
  return Math.ceil(Math.max(1, width) * Math.max(1, height) * 4 * DECODED_PIXEL_OVERHEAD);
}

async function decodeImageSource(
  source: string,
  fallback: Pick<BookPage, "width" | "height"> | undefined,
): Promise<{ width: number; height: number }> {
  const image = new globalThis.Image();
  image.decoding = "async";
  image.src = source;
  if (typeof image.decode === "function") {
    await image.decode();
  } else {
    return {
      width: fallback?.width ?? 1,
      height: fallback?.height ?? 1,
    };
  }
  return {
    width: image.naturalWidth || fallback?.width || 1,
    height: image.naturalHeight || fallback?.height || 1,
  };
}
