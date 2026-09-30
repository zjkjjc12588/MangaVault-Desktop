import type { ReaderPresentation } from "../lib/readerPresentation";

export type ReaderChromeRegion = "all" | "top" | "bottom" | "hidden";
export type ReaderOverlay =
  | "tutorial"
  | "fullscreen-hint"
  | "focus-prompt"
  | "image"
  | "advanced-image"
  | "bookmarks"
  | "more"
  | "thumbnails"
  | null;

export interface ReaderUiState {
  chrome: ReaderChromeRegion;
  overlay: ReaderOverlay;
}

export type ReaderUiEvent =
  | { type: "reveal"; region: Exclude<ReaderChromeRegion, "hidden"> }
  | { type: "toggle-controls" }
  | { type: "hide" }
  | { type: "open-overlay"; overlay: Exclude<ReaderOverlay, null> }
  | { type: "close-overlay" }
  | { type: "windowed" }
  | { type: "enter-immersive" };

export const initialReaderUiState: ReaderUiState = {
  chrome: "all",
  overlay: null,
};

export function readerUiReducer(state: ReaderUiState, event: ReaderUiEvent): ReaderUiState {
  switch (event.type) {
    case "reveal":
      return { ...state, chrome: event.region };
    case "toggle-controls":
      return { ...state, chrome: state.chrome === "hidden" ? "all" : "hidden" };
    case "hide":
      return { ...state, chrome: "hidden" };
    case "open-overlay":
      return { chrome: "all", overlay: event.overlay };
    case "close-overlay":
      return { ...state, overlay: null };
    case "windowed":
      return initialReaderUiState;
    case "enter-immersive":
      return { chrome: "hidden", overlay: null };
  }
}

export interface ChromeGuards {
  pointerOverControls: boolean;
  focusWithinControls: boolean;
  draggingControl: boolean;
  contentGesture: boolean;
  pageInputActive: boolean;
  inertialScrolling: boolean;
  textSelecting: boolean;
  panelOpen: boolean;
  blockingError: boolean;
}

export const emptyChromeGuards: ChromeGuards = {
  pointerOverControls: false,
  focusWithinControls: false,
  draggingControl: false,
  contentGesture: false,
  pageInputActive: false,
  inertialScrolling: false,
  textSelecting: false,
  panelOpen: false,
  blockingError: false,
};

export function canAutoHideChrome(presentation: ReaderPresentation, guards: ChromeGuards): boolean {
  return presentation !== "normal" && Object.values(guards).every((guard) => !guard);
}

export type ReaderEscapeAction =
  "close-overlay" | "exit-focus" | "exit-immersive" | "exit-fullscreen" | "none";

export function readerEscapeAction({
  overlayOpen,
  presentation,
  fullscreen,
}: {
  overlayOpen: boolean;
  presentation: ReaderPresentation;
  fullscreen: boolean;
}): ReaderEscapeAction {
  if (overlayOpen) return "close-overlay";
  if (presentation === "focus") return "exit-focus";
  if (presentation === "immersive") return "exit-immersive";
  if (fullscreen || presentation === "fullscreen") return "exit-fullscreen";
  return "none";
}

export type ReaderEdgeHotZone = "top" | "bottom" | null;

export function readerEdgeHotZone(
  clientY: number,
  top: number,
  height: number,
  hotZoneSize = 10,
): ReaderEdgeHotZone {
  const relativeY = clientY - top;
  if (relativeY < 0 || relativeY > height) return null;
  if (relativeY <= hotZoneSize) return "top";
  if (relativeY >= height - hotZoneSize) return "bottom";
  return null;
}
