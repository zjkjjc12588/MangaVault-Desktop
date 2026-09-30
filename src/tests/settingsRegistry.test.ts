import { describe, expect, it } from "vitest";
import {
  normalizeSettingsSection,
  searchSettings,
  settingsItems,
  settingsSections,
} from "../settings/settingsRegistry";

describe("settings registry", () => {
  it("keeps nine ordered, unique categories and places diagnostics late", () => {
    expect(settingsSections).toHaveLength(9);
    expect(new Set(settingsSections.map((section) => section.sectionId)).size).toBe(9);
    expect(settingsSections.map((section) => section.sectionId)).toEqual([
      "general",
      "library",
      "reader",
      "display",
      "input",
      "storage",
      "data",
      "advanced",
      "about",
    ]);
    expect(settingsSections.find((section) => section.sectionId === "advanced")?.isAdvanced).toBe(
      true,
    );
  });

  it("uses structured bilingual metadata instead of scanning rendered DOM", () => {
    expect(searchSettings("双击", "zh-CN")[0]).toMatchObject({
      settingId: "library.open_mouse_action",
      sectionId: "library",
    });
    expect(searchSettings("backup", "en-US").some((result) => result.sectionId === "data")).toBe(
      true,
    );
    expect(searchSettings("7z", "zh-CN")[0]?.settingId).toBe("library.formats");
    expect(searchSettings("JM ID", "zh-CN")[0]?.settingId).toBe("library.jmcomic");
    expect(searchSettings("", "zh-CN")).toEqual([]);
  });

  it("maps every item to an existing category and keeps destructive data out of defaults", () => {
    const sections = new Set(settingsSections.map((section) => section.sectionId));
    expect(settingsItems.every((item) => sections.has(item.sectionId))).toBe(true);
    const defaultKeys = settingsSections.flatMap((section) => Object.keys(section.restoreDefaults));
    expect(defaultKeys).not.toContain("reading_progress");
    expect(defaultKeys).not.toContain("reading_history");
    expect(defaultKeys).not.toContain("libraries");
  });

  it("restores only valid persisted categories", () => {
    expect(normalizeSettingsSection("input")).toBe("input");
    expect(normalizeSettingsSection("future" as never)).toBe("general");
  });
});
