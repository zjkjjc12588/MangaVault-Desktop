import type { Book } from "./types";

export interface SeriesGroup {
  key: string;
  title: string;
  author: string | null;
  books: Book[];
  pageCount: number;
  progressPercent: number;
}

export function groupBooksBySeries(books: Book[]): SeriesGroup[] {
  const groups = new Map<string, Book[]>();
  for (const book of books) {
    const key = book.seriesId ? `series:${book.seriesId}` : `title:${book.sortTitle}`;
    groups.set(key, [...(groups.get(key) ?? []), book]);
  }
  return Array.from(groups.entries())
    .map(([key, groupedBooks]) => {
      const sortedBooks = [...groupedBooks].sort(compareSeriesBook);
      const first = sortedBooks[0];
      const pageCount = sortedBooks.reduce((sum, book) => sum + book.pageCount, 0);
      const weightedProgress =
        pageCount === 0
          ? 0
          : sortedBooks.reduce(
              (sum, book) => sum + book.progressPercent * Math.max(1, book.pageCount),
              0,
            ) / sortedBooks.reduce((sum, book) => sum + Math.max(1, book.pageCount), 0);
      return {
        key,
        title: first.title,
        author: first.author,
        books: sortedBooks,
        pageCount,
        progressPercent: weightedProgress,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

function compareSeriesBook(a: Book, b: Book): number {
  return (
    compareNullableNumber(a.volume, b.volume) ||
    compareNullableNumber(a.chapter, b.chapter) ||
    a.sortTitle.localeCompare(b.sortTitle, undefined, { sensitivity: "base" })
  );
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
