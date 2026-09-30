import { describe, expect, it } from "vitest";
import { groupBooksBySeries } from "../lib/series";
import type { Book } from "../lib/types";

const baseBook: Book = {
  id: 1,
  libraryId: 1,
  seriesId: 1,
  title: "Signal Garden",
  sortTitle: "signal garden",
  author: "Ada",
  volume: null,
  chapter: null,
  path: "D:/Manga/Signal Garden 1.cbz",
  format: "cbz",
  fileSize: 1024,
  modifiedAt: null,
  pageCount: 100,
  coverPageIndex: 0,
  coverCacheKey: null,
  isFavorite: false,
  rating: 0,
  status: "available",
  importedAt: "2026-07-08T00:00:00Z",
  updatedAt: "2026-07-08T00:00:00Z",
  lastReadAt: null,
  progressPercent: 0,
  tags: [],
};

describe("series grouping", () => {
  it("groups by series id and sorts books by volume then chapter", () => {
    const groups = groupBooksBySeries([
      { ...baseBook, id: 2, volume: 2, chapter: 3, progressPercent: 0.5 },
      { ...baseBook, id: 1, volume: 1, chapter: 10, progressPercent: 1 },
      { ...baseBook, id: 3, volume: 1, chapter: 2, progressPercent: 0 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].books.map((book) => book.id)).toEqual([3, 1, 2]);
    expect(groups[0].pageCount).toBe(300);
    expect(groups[0].progressPercent).toBeCloseTo(0.5);
  });

  it("falls back to normalized title when no series id exists", () => {
    const groups = groupBooksBySeries([
      { ...baseBook, id: 1, seriesId: null, sortTitle: "alpha", title: "Alpha" },
      { ...baseBook, id: 2, seriesId: null, sortTitle: "alpha", title: "Alpha Deluxe" },
      { ...baseBook, id: 3, seriesId: null, sortTitle: "beta", title: "Beta" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].books).toHaveLength(2);
    expect(groups[1].title).toBe("Beta");
  });
});
