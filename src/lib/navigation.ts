export type AppRoute = "library" | "recent" | "reader" | "settings";

export type NavigationSection = "main" | "system";

export interface NavigationItem {
  id: string;
  route: AppRoute;
  label: string;
  section: NavigationSection;
  visibleByDefault: boolean;
}

export interface LayoutSettings {
  sidebarMode: "expanded" | "compact";
  gridDensity: "comfortable" | "compact" | "spacious";
  coverAspectRatio: "portrait" | "square" | "tall";
  commandPaletteEnabled: boolean;
  customShortcutsEnabled: boolean;
}

export interface SidebarModeResolution {
  preferred: LayoutSettings["sidebarMode"];
  effective: LayoutSettings["sidebarMode"];
  constrained: boolean;
}

export const SIDEBAR_FORCE_COMPACT_MAX_WIDTH = 1079;
export const SIDEBAR_COMPACT_MEDIA_QUERY = `(max-width: ${SIDEBAR_FORCE_COMPACT_MAX_WIDTH}px)`;

export const navigationItems: NavigationItem[] = [
  {
    id: "nav.library",
    route: "library",
    label: "Library",
    section: "main",
    visibleByDefault: true,
  },
  {
    id: "nav.recent",
    route: "recent",
    label: "Recent",
    section: "main",
    visibleByDefault: true,
  },
  {
    id: "nav.settings",
    route: "settings",
    label: "Settings",
    section: "system",
    visibleByDefault: true,
  },
];

export const defaultLayoutSettings: LayoutSettings = {
  sidebarMode: "expanded",
  gridDensity: "comfortable",
  coverAspectRatio: "portrait",
  commandPaletteEnabled: true,
  customShortcutsEnabled: false,
};

let currentLayoutSettings = defaultLayoutSettings;
const layoutListeners = new Set<() => void>();

export function getLayoutSettings(): LayoutSettings {
  return currentLayoutSettings;
}

export function subscribeLayoutSettings(listener: () => void): () => void {
  layoutListeners.add(listener);
  return () => layoutListeners.delete(listener);
}

export function syncLayoutSettings(values: Record<string, unknown>): LayoutSettings {
  const next = normalizeLayoutSettings(values);
  if (layoutSettingsEqual(currentLayoutSettings, next)) return currentLayoutSettings;
  currentLayoutSettings = next;
  layoutListeners.forEach((listener) => listener());
  return currentLayoutSettings;
}

export function setPreferredSidebarMode(
  sidebarMode: LayoutSettings["sidebarMode"],
): LayoutSettings {
  if (sidebarMode === currentLayoutSettings.sidebarMode) return currentLayoutSettings;
  currentLayoutSettings = { ...currentLayoutSettings, sidebarMode };
  layoutListeners.forEach((listener) => listener());
  return currentLayoutSettings;
}

export function resolveSidebarMode(
  preferred: LayoutSettings["sidebarMode"],
  narrowViewport: boolean,
): SidebarModeResolution {
  return {
    preferred,
    effective: narrowViewport ? "compact" : preferred,
    constrained: narrowViewport && preferred === "expanded",
  };
}

export function resolveSidebarModeForWidth(
  preferred: LayoutSettings["sidebarMode"],
  viewportWidth: number,
): SidebarModeResolution {
  return resolveSidebarMode(preferred, viewportWidth <= SIDEBAR_FORCE_COMPACT_MAX_WIDTH);
}

export function normalizeLayoutSettings(values: Record<string, unknown>): LayoutSettings {
  return {
    sidebarMode:
      values["ui.layout.sidebar_mode"] === "compact"
        ? "compact"
        : defaultLayoutSettings.sidebarMode,
    gridDensity: isGridDensity(values["ui.layout.grid_density"])
      ? values["ui.layout.grid_density"]
      : defaultLayoutSettings.gridDensity,
    coverAspectRatio: isCoverAspectRatio(values["ui.layout.cover_aspect_ratio"])
      ? values["ui.layout.cover_aspect_ratio"]
      : defaultLayoutSettings.coverAspectRatio,
    commandPaletteEnabled:
      values["ui.command_palette.enabled"] === false
        ? false
        : defaultLayoutSettings.commandPaletteEnabled,
    customShortcutsEnabled: values["ui.shortcuts.custom_enabled"] === true,
  };
}

function isGridDensity(value: unknown): value is LayoutSettings["gridDensity"] {
  return value === "comfortable" || value === "compact" || value === "spacious";
}

function isCoverAspectRatio(value: unknown): value is LayoutSettings["coverAspectRatio"] {
  return value === "portrait" || value === "square" || value === "tall";
}

function layoutSettingsEqual(left: LayoutSettings, right: LayoutSettings): boolean {
  return (
    left.sidebarMode === right.sidebarMode &&
    left.gridDensity === right.gridDensity &&
    left.coverAspectRatio === right.coverAspectRatio &&
    left.commandPaletteEnabled === right.commandPaletteEnabled &&
    left.customShortcutsEnabled === right.customShortcutsEnabled
  );
}
