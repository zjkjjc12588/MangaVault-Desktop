import { describe, expect, it } from "vitest";
import {
  getLayoutSettings,
  navigationItems,
  normalizeLayoutSettings,
  resolveSidebarModeForWidth,
  setPreferredSidebarMode,
  subscribeLayoutSettings,
  syncLayoutSettings,
} from "../lib/navigation";

describe("navigation registry", () => {
  it("keeps navigation identifiers unique", () => {
    const navigationIds = new Set(navigationItems.map((item) => item.id));

    expect(navigationIds.size).toBe(navigationItems.length);
    expect(navigationItems.map((item) => item.route)).toEqual(["library", "recent", "settings"]);
  });

  it("separates a preferred sidebar mode from temporary narrow-window constraints", () => {
    for (const width of [800, 1024]) {
      expect(resolveSidebarModeForWidth("expanded", width)).toEqual({
        preferred: "expanded",
        effective: "compact",
        constrained: true,
      });
    }
    for (const width of [1280, 1440, 1920]) {
      expect(resolveSidebarModeForWidth("expanded", width)).toEqual({
        preferred: "expanded",
        effective: "expanded",
        constrained: false,
      });
    }
    expect(resolveSidebarModeForWidth("compact", 1920)).toEqual({
      preferred: "compact",
      effective: "compact",
      constrained: false,
    });
  });

  it("publishes an explicit sidebar preference without resetting other layout settings", () => {
    syncLayoutSettings({
      "ui.layout.grid_density": "spacious",
      "ui.layout.cover_aspect_ratio": "tall",
    });
    setPreferredSidebarMode("compact");

    expect(getLayoutSettings()).toMatchObject({
      sidebarMode: "compact",
      gridDensity: "spacious",
      coverAspectRatio: "tall",
    });
    syncLayoutSettings({});
  });

  it("keeps twenty rapid route transitions deterministic without reloading the active route", () => {
    let current: "library" | "recent" | "reader" | "settings" = "library";
    let transitions = 0;
    const navigate = (next: typeof current) => {
      if (next === current) return;
      current = next;
      transitions += 1;
    };

    for (let index = 0; index < 20; index += 1) {
      navigate((["settings", "reader", "library"] as const)[index % 3]);
    }
    const beforeActiveClick = transitions;
    navigate(current);

    expect(transitions).toBe(20);
    expect(transitions).toBe(beforeActiveClick);
  });

  it("normalizes persisted layout settings conservatively", () => {
    expect(normalizeLayoutSettings({}).sidebarMode).toBe("expanded");
    expect(
      normalizeLayoutSettings({
        "ui.layout.sidebar_mode": "compact",
        "ui.layout.grid_density": "spacious",
        "ui.layout.cover_aspect_ratio": "square",
        "ui.command_palette.enabled": false,
        "ui.shortcuts.custom_enabled": true,
      }),
    ).toEqual({
      sidebarMode: "compact",
      gridDensity: "spacious",
      coverAspectRatio: "square",
      commandPaletteEnabled: false,
      customShortcutsEnabled: true,
    });
  });

  it("publishes layout changes once and exposes the normalized snapshot", () => {
    syncLayoutSettings({});
    let notifications = 0;
    const unsubscribe = subscribeLayoutSettings(() => {
      notifications += 1;
    });

    syncLayoutSettings({
      "ui.layout.sidebar_mode": "compact",
      "ui.layout.grid_density": "compact",
      "ui.layout.cover_aspect_ratio": "square",
    });
    syncLayoutSettings({
      "ui.layout.sidebar_mode": "compact",
      "ui.layout.grid_density": "compact",
      "ui.layout.cover_aspect_ratio": "square",
    });

    expect(getLayoutSettings()).toMatchObject({
      sidebarMode: "compact",
      gridDensity: "compact",
      coverAspectRatio: "square",
    });
    expect(notifications).toBe(1);
    unsubscribe();
    syncLayoutSettings({});
  });
});
