import { describe, expect, it } from "vitest";
import { formatUserError, getUiLocale, resolveLocale, setUiLocale, t } from "../lib/i18n";

describe("i18n", () => {
  it("uses Chinese by default for the desktop build", () => {
    setUiLocale("zh-CN");
    expect(t("library")).toBe("漫画库");
    expect(t("importFile")).toBe("导入文件");
    expect(t("desktopApp")).toBe("桌面端");
  });

  it("keeps English translations available", () => {
    expect(resolveLocale("en-US")).toBe("en");
    expect(t("reader", "en-US")).toBe("Reader");
    expect(t("search", "en-US")).toBe("Search title, author, JM ID, tag, or path");
  });

  it("localizes reader controls and drag import feedback", () => {
    setUiLocale("zh-CN");
    expect(t("fitWidth")).toBe("适应宽度");
    expect(t("directionRtl")).toBe("从右到左");
    expect(t("readerTutorialTitle")).toBe("阅读热区");
    expect(t("returnLibrary")).toBe("返回漫画库");
    expect(t("returnRecent")).toBe("返回最近阅读");
    expect(t("dropToImportTitle")).toBe("松开即可导入");
    expect(t("scanDiscovering")).toBe("正在发现漫画");
    expect(t("scanInProgressTitle")).toBe("正在建立漫画库");
    expect(t("fitOriginal", "en-US")).toBe("Original size");
    expect(t("nextPage", "en-US")).toBe("Next page");
    expect(t("readerTutorialTitle", "en-US")).toBe("Reading zones");
    expect(t("returnLibrary", "en-US")).toBe("Back to library");
    expect(t("returnRecent", "en-US")).toBe("Back to Recent");
    expect(t("dropToImportTitle", "en-US")).toBe("Drop to import");
    expect(t("scanDiscovering", "en-US")).toBe("Discovering manga");
    expect(t("scanInProgressTitle", "en-US")).toBe("Building your manga library");
  });

  it("updates the global UI locale", () => {
    expect(setUiLocale("en-US")).toBe("en-US");
    expect(getUiLocale()).toBe("en-US");
    expect(t("settings")).toBe("Settings");
    setUiLocale("zh-CN");
  });

  it("localizes common backend errors while retaining useful details", () => {
    expect(formatUserError("invalid path", "zh-CN")).toBe("路径无效或已无法访问。");
    expect(formatUserError("unsupported format: epub", "zh-CN")).toBe("不支持的文件格式：epub");
    expect(formatUserError("io error: access denied", "en-US")).toBe(
      "File access error: access denied",
    );
    expect(formatUserError("database lock poisoned", "en-US")).toBe(
      "The database is temporarily unavailable. Please try again.",
    );
    expect(formatUserError("page unavailable", "zh-CN")).toBe(t("errorPageUnavailable", "zh-CN"));
    expect(formatUserError("unexpected scanner state", "zh-CN")).toBe(
      t("errorUnexpected", "zh-CN"),
    );
    expect(formatUserError("unexpected scanner state", "en-US")).toBe("unexpected scanner state");
  });
});
