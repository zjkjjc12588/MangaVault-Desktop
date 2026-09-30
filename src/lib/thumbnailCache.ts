import { getThumbnailData } from "./api";

const maxEntries = 512;
const maxConcurrent = 4;
const cache = new Map<string, string>();
const pending = new Map<string, PendingRequest>();
const queue: QueueItem[] = [];
let active = 0;
let cacheGeneration = 0;
let queueSequence = 0;

export type ThumbnailPriority = "background" | "visible" | "reader";

export interface ThumbnailRequestOptions {
  signal?: AbortSignal;
  priority?: ThumbnailPriority;
}

interface PendingRequest {
  generation: number;
  key: string;
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
  waiters: Set<symbol>;
  started: boolean;
  queueItem: QueueItem | null;
}

interface QueueItem {
  entry: PendingRequest;
  priority: number;
  sequence: number;
  start: () => void;
}

export function thumbnailCacheKey(bookId: number, pageIndex: number): string {
  return `${bookId}:${pageIndex}`;
}

export function clearThumbnailMemoryCache(): void {
  cacheGeneration += 1;
  cache.clear();
  pending.clear();
  for (const item of queue.splice(0)) {
    item.entry.queueItem = null;
    item.entry.reject(new Error("thumbnail cache cleared"));
  }
}

export function getCachedThumbnailDataUrl(
  bookId: number,
  pageIndex: number,
  options: ThumbnailRequestOptions = {},
): Promise<string> {
  const key = thumbnailCacheKey(bookId, pageIndex);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  if (options.signal?.aborted) return Promise.reject(abortError());

  let entry = pending.get(key);
  if (!entry) {
    entry = createPendingRequest(
      key,
      () => getThumbnailData(bookId, pageIndex).then((payload) => payload.dataUrl),
      priorityValue(options.priority ?? "background"),
    );
    pending.set(key, entry);
    schedule(entry);
  } else {
    promoteQueuedRequest(entry, priorityValue(options.priority ?? "background"));
  }
  return waitForRequest(entry, options.signal);
}

function createPendingRequest(
  key: string,
  task: () => Promise<string>,
  priority: number,
): PendingRequest {
  let resolveRequest!: (value: string) => void;
  let rejectRequest!: (error: unknown) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const entry: PendingRequest = {
    generation: cacheGeneration,
    key,
    promise,
    resolve: resolveRequest,
    reject: rejectRequest,
    waiters: new Set(),
    started: false,
    queueItem: null,
  };
  const start = () => {
    entry.started = true;
    entry.queueItem = null;
    active += 1;
    task()
      .then((value) => {
        if (entry.generation === cacheGeneration) remember(key, value);
        entry.resolve(value);
      }, entry.reject)
      .finally(() => {
        if (pending.get(key) === entry) pending.delete(key);
        active -= 1;
        drainQueue();
      });
  };
  entry.queueItem = {
    entry,
    priority,
    sequence: queueSequence++,
    start,
  };
  return entry;
}

function schedule(entry: PendingRequest): void {
  const item = entry.queueItem;
  if (!item) return;
  if (active < maxConcurrent) {
    item.start();
    return;
  }
  queue.push(item);
  sortQueue();
}

function promoteQueuedRequest(entry: PendingRequest, priority: number): void {
  const item = entry.queueItem;
  if (!item || item.priority >= priority) return;
  item.priority = priority;
  sortQueue();
}

function waitForRequest(entry: PendingRequest, signal?: AbortSignal): Promise<string> {
  const waiter = Symbol(entry.key);
  entry.waiters.add(waiter);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      entry.waiters.delete(waiter);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      finish(() => {
        reject(abortError());
        cancelQueuedRequestWithoutWaiters(entry);
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function cancelQueuedRequestWithoutWaiters(entry: PendingRequest): void {
  const item = entry.queueItem;
  if (entry.started || entry.waiters.size > 0 || !item) return;
  const index = queue.indexOf(item);
  if (index >= 0) queue.splice(index, 1);
  entry.queueItem = null;
  if (pending.get(entry.key) === entry) pending.delete(entry.key);
  entry.reject(abortError());
}

function remember(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const first = cache.keys().next().value;
    if (typeof first === "string") cache.delete(first);
  }
}

function drainQueue(): void {
  while (active < maxConcurrent && queue.length > 0) {
    const item = queue.shift();
    if (!item || item.entry.queueItem !== item) continue;
    item.start();
  }
}

function sortQueue(): void {
  queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
}

function priorityValue(priority: ThumbnailPriority): number {
  if (priority === "reader") return 20;
  if (priority === "visible") return 10;
  return 0;
}

function abortError(): Error {
  const error = new Error("thumbnail request cancelled");
  error.name = "AbortError";
  return error;
}
