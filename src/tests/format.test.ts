import { describe, expect, it } from "vitest";
import {
  displayLocalDateTime,
  displayPath,
  formatBytes,
  formatDateTime,
  formatPercent,
  libraryStatusText,
} from "../lib/format";

describe("format helpers", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats progress", () => {
    expect(formatPercent(0.375)).toBe("38%");
  });

  it("uses the application locale for date and byte formatting", () => {
    expect(formatBytes(1024, "en-US")).toBe("1.0 KB");
    expect(formatDateTime("not-a-date", "zh-CN")).toBe("not-a-date");
    expect(formatDateTime("2026-07-12T03:04:05Z", "zh-CN")).not.toBe(
      formatDateTime("2026-07-12T03:04:05Z", "en-US"),
    );
  });

  it("removes Windows long-path prefixes only for display", () => {
    expect(displayPath(String.raw`\\?\D:\MangaFixture\作品`)).toBe(String.raw`D:\MangaFixture\作品`);
    expect(displayPath("\\\\?\\D:\\")).toBe("D:\\");
    expect(displayPath("\\\\?\\D:\\MangaFixture\\")).toBe("D:\\MangaFixture\\");
    expect(displayPath(String.raw`\\?\UNC\server\share\漫画`)).toBe(
      String.raw`\\server\share\漫画`,
    );
    expect(displayPath(String.raw`\\server\share\漫画`)).toBe(String.raw`\\server\share\漫画`);
  });

  it("formats ordinary timestamps in local time to the minute", () => {
    const formatted = displayLocalDateTime("2026-07-12T03:04:47.123456Z", "en-US");
    expect(formatted).not.toContain(".123");
    expect(formatted).not.toContain("+00:00");
    expect(formatted).not.toMatch(/:47(?:\D|$)/);
  });

  it("summarizes each library with count, recursion, and local scan time", () => {
    expect(
      libraryStatusText(
        {
          bookCount: 270,
          recursive: true,
          lastScanAt: null,
        },
        "zh-CN",
      ),
    ).toBe("270 本漫画 · 包含子文件夹 · 尚未扫描");
  });
});
