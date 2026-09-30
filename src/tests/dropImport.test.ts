import { describe, expect, it } from "vitest";
import { browserDroppedPaths, isFileDrag, normalizeDroppedPaths } from "../lib/dropImport";

describe("drop import paths", () => {
  it("normalizes duplicate and whitespace-padded native paths", () => {
    expect(
      normalizeDroppedPaths([" D:/Manga/One.cbz ", "", "D:/Manga/One.cbz", "D:/Manga"]),
    ).toEqual(["D:/Manga/One.cbz", "D:/Manga"]);
  });

  it("reads browser File.path fallback values when available", () => {
    const files = [
      { path: "D:/Manga/One.cbz" },
      { path: "D:/Manga/One.cbz" },
      { path: " D:/Manga/Two.pdf " },
    ] as unknown as Array<File & { path?: string }>;

    expect(browserDroppedPaths(files)).toEqual(["D:/Manga/One.cbz", "D:/Manga/Two.pdf"]);
  });

  it("recognizes file drags only", () => {
    expect(isFileDrag(["text/plain", "Files"])).toBe(true);
    expect(isFileDrag(["text/plain"])).toBe(false);
  });
});
