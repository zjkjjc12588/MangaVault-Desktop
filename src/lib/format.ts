import { getUiLocale, type Locale } from "./i18n";
import type { Library } from "./types";

export function formatBytes(bytes: number, locale: Locale = getUiLocale()): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const digits = index === 0 ? 0 : 1;
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(bytes / 1024 ** index);
  return `${amount} ${units[index]}`;
}

export function formatPercent(value: number, locale: Locale = getUiLocale()): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    value,
  );
}

export function formatNumber(value: number, locale: Locale = getUiLocale()): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDateTime(value: string, locale: Locale = getUiLocale()): string {
  return displayLocalDateTime(value, locale);
}

export function displayLocalDateTime(value: string, locale: Locale = getUiLocale()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function displayPath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`;
  if (/^\\\\\?\\[a-z]:/i.test(path)) return path.slice(4);
  return path;
}

export function libraryStatusText(
  library: Pick<Library, "bookCount" | "recursive" | "lastScanAt">,
  locale: Locale = getUiLocale(),
): string {
  const count = formatNumber(library.bookCount, locale);
  const scanTime = library.lastScanAt
    ? displayLocalDateTime(library.lastScanAt, locale)
    : locale === "zh-CN"
      ? "尚未扫描"
      : "Not scanned yet";
  if (locale === "zh-CN") {
    return `${count} 本漫画 · ${library.recursive ? "包含子文件夹" : "仅当前文件夹"} · ${scanTime}`;
  }
  return `${count} comics · ${library.recursive ? "Includes subfolders" : "Top folder only"} · ${scanTime}`;
}
