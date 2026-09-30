import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, normalizeTheme, shouldUseLightTheme } from "../lib/theme";

describe("theme preferences", () => {
  afterEach(() => {
    document.documentElement.classList.remove("light");
    vi.restoreAllMocks();
  });

  it("normalizes persisted values", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("system")).toBe("system");
    expect(normalizeTheme("sepia")).toBe("system");
    expect(normalizeTheme(null)).toBe("system");
  });

  it("applies explicit light and dark themes", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    applyTheme("dark");
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("uses system preference for system theme", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: light)",
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    expect(shouldUseLightTheme("system")).toBe(true);
  });
});
