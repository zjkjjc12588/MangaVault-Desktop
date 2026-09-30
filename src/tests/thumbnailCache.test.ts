import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getThumbnailData: vi.fn(),
}));

vi.mock("../lib/api", () => api);

describe("thumbnail memory cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearThumbnailMemoryCache } = await import("../lib/thumbnailCache");
    clearThumbnailMemoryCache();
    api.getThumbnailData.mockImplementation((_bookId: number, pageIndex: number) =>
      Promise.resolve({ pageIndex, mimeType: "image/png", dataUrl: `data:${pageIndex}` }),
    );
  });

  it("deduplicates repeated thumbnail requests", async () => {
    const { getCachedThumbnailDataUrl } = await import("../lib/thumbnailCache");

    const [first, second, third] = await Promise.all([
      getCachedThumbnailDataUrl(1, 0),
      getCachedThumbnailDataUrl(1, 0),
      getCachedThumbnailDataUrl(1, 0),
    ]);
    const cached = await getCachedThumbnailDataUrl(1, 0);

    expect(first).toBe("data:0");
    expect(second).toBe("data:0");
    expect(third).toBe("data:0");
    expect(cached).toBe("data:0");
    expect(api.getThumbnailData).toHaveBeenCalledTimes(1);
  });

  it("limits concurrent thumbnail requests", async () => {
    const resolvers = new Map<number, (value: unknown) => void>();
    api.getThumbnailData.mockImplementation(
      (_bookId: number, pageIndex: number) =>
        new Promise((resolve) => {
          resolvers.set(pageIndex, resolve);
        }),
    );
    const { getCachedThumbnailDataUrl } = await import("../lib/thumbnailCache");

    const requests = Array.from({ length: 6 }, (_, pageIndex) =>
      getCachedThumbnailDataUrl(1, pageIndex),
    );
    await Promise.resolve();

    expect(api.getThumbnailData).toHaveBeenCalledTimes(4);
    resolvers.get(0)?.({ pageIndex: 0, mimeType: "image/png", dataUrl: "data:0" });
    await requests[0];
    await Promise.resolve();

    expect(api.getThumbnailData).toHaveBeenCalledTimes(5);
    resolvers.get(1)?.({ pageIndex: 1, mimeType: "image/png", dataUrl: "data:1" });
    await requests[1];
    await Promise.resolve();

    expect(api.getThumbnailData).toHaveBeenCalledTimes(6);
    for (let pageIndex = 2; pageIndex < 6; pageIndex += 1) {
      resolvers.get(pageIndex)?.({
        pageIndex,
        mimeType: "image/png",
        dataUrl: `data:${pageIndex}`,
      });
    }
    await Promise.all(requests);
  });

  it("rejects queued thumbnail requests when cache is cleared", async () => {
    const resolvers = new Map<number, (value: unknown) => void>();
    api.getThumbnailData.mockImplementation(
      (_bookId: number, pageIndex: number) =>
        new Promise((resolve) => {
          resolvers.set(pageIndex, resolve);
        }),
    );
    const { clearThumbnailMemoryCache, getCachedThumbnailDataUrl } =
      await import("../lib/thumbnailCache");

    const requests = Array.from({ length: 5 }, (_, pageIndex) =>
      getCachedThumbnailDataUrl(1, pageIndex),
    );
    await Promise.resolve();
    clearThumbnailMemoryCache();

    await expect(requests[4]).rejects.toThrow("thumbnail cache cleared");
    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      resolvers.get(pageIndex)?.({
        pageIndex,
        mimeType: "image/png",
        dataUrl: `data:${pageIndex}`,
      });
    }
    await Promise.all(requests.slice(0, 4));
  });

  it("cancels queued covers that leave the viewport", async () => {
    const resolvers = new Map<number, (value: unknown) => void>();
    api.getThumbnailData.mockImplementation(
      (_bookId: number, pageIndex: number) =>
        new Promise((resolve) => {
          resolvers.set(pageIndex, resolve);
        }),
    );
    const { getCachedThumbnailDataUrl } = await import("../lib/thumbnailCache");
    const controller = new AbortController();
    const activeRequests = Array.from({ length: 4 }, (_, pageIndex) =>
      getCachedThumbnailDataUrl(1, pageIndex),
    );
    const stale = getCachedThumbnailDataUrl(1, 4, {
      signal: controller.signal,
      priority: "visible",
    });
    const nextVisible = getCachedThumbnailDataUrl(1, 5, { priority: "visible" });
    await Promise.resolve();

    controller.abort();
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    resolvers.get(0)?.({ pageIndex: 0, mimeType: "image/png", dataUrl: "data:0" });
    await activeRequests[0];
    await Promise.resolve();

    expect(api.getThumbnailData).toHaveBeenLastCalledWith(1, 5);
    resolvers.get(5)?.({ pageIndex: 5, mimeType: "image/png", dataUrl: "data:5" });
    for (let pageIndex = 1; pageIndex < 4; pageIndex += 1) {
      resolvers.get(pageIndex)?.({
        pageIndex,
        mimeType: "image/png",
        dataUrl: `data:${pageIndex}`,
      });
    }
    await Promise.all([...activeRequests.slice(1), nextVisible]);
  });

  it("loads reader thumbnails ahead of queued library covers", async () => {
    const resolvers = new Map<number, (value: unknown) => void>();
    api.getThumbnailData.mockImplementation(
      (_bookId: number, pageIndex: number) =>
        new Promise((resolve) => {
          resolvers.set(pageIndex, resolve);
        }),
    );
    const { getCachedThumbnailDataUrl } = await import("../lib/thumbnailCache");
    const activeRequests = Array.from({ length: 4 }, (_, pageIndex) =>
      getCachedThumbnailDataUrl(1, pageIndex),
    );
    const cover = getCachedThumbnailDataUrl(1, 4, { priority: "visible" });
    const reader = getCachedThumbnailDataUrl(1, 5, { priority: "reader" });
    await Promise.resolve();

    resolvers.get(0)?.({ pageIndex: 0, mimeType: "image/png", dataUrl: "data:0" });
    await activeRequests[0];
    await Promise.resolve();
    expect(api.getThumbnailData).toHaveBeenLastCalledWith(1, 5);

    resolvers.get(5)?.({ pageIndex: 5, mimeType: "image/png", dataUrl: "data:5" });
    await reader;
    await Promise.resolve();
    resolvers.get(4)?.({ pageIndex: 4, mimeType: "image/png", dataUrl: "data:4" });
    for (let pageIndex = 1; pageIndex < 4; pageIndex += 1) {
      resolvers.get(pageIndex)?.({
        pageIndex,
        mimeType: "image/png",
        dataUrl: `data:${pageIndex}`,
      });
    }
    await Promise.all([...activeRequests.slice(1), cover]);
  });
});
