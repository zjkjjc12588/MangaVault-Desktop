import { describe, expect, it } from "vitest";
import {
  canAutoHideChrome,
  emptyChromeGuards,
  initialReaderUiState,
  readerEdgeHotZone,
  readerEscapeAction,
  readerUiReducer,
} from "../reader/readerUiState";

describe("reader UI state machine", () => {
  it("tracks windowed, hidden, regional chrome, overlays, and immersive entry", () => {
    expect(readerUiReducer(initialReaderUiState, { type: "hide" })).toEqual({
      chrome: "hidden",
      overlay: null,
    });
    expect(
      readerUiReducer({ chrome: "hidden", overlay: null }, { type: "reveal", region: "top" }),
    ).toEqual({ chrome: "top", overlay: null });
    expect(
      readerUiReducer(
        { chrome: "bottom", overlay: null },
        { type: "open-overlay", overlay: "thumbnails" },
      ),
    ).toEqual({ chrome: "all", overlay: "thumbnails" });
    expect(
      readerUiReducer({ chrome: "all", overlay: "more" }, { type: "enter-immersive" }),
    ).toEqual({ chrome: "hidden", overlay: null });
    expect(
      readerUiReducer({ chrome: "hidden", overlay: "tutorial" }, { type: "windowed" }),
    ).toEqual(initialReaderUiState);
  });

  it("toggles all controls without changing the active overlay", () => {
    expect(
      readerUiReducer({ chrome: "all", overlay: null }, { type: "toggle-controls" }).chrome,
    ).toBe("hidden");
    expect(
      readerUiReducer({ chrome: "hidden", overlay: null }, { type: "toggle-controls" }).chrome,
    ).toBe("all");
  });

  it("applies the required Escape priority", () => {
    expect(
      readerEscapeAction({ overlayOpen: false, presentation: "focus", fullscreen: true }),
    ).toBe("exit-focus");
    expect(
      readerEscapeAction({ overlayOpen: true, presentation: "immersive", fullscreen: true }),
    ).toBe("close-overlay");
    expect(
      readerEscapeAction({ overlayOpen: false, presentation: "immersive", fullscreen: true }),
    ).toBe("exit-immersive");
    expect(
      readerEscapeAction({ overlayOpen: false, presentation: "fullscreen", fullscreen: true }),
    ).toBe("exit-fullscreen");
    expect(
      readerEscapeAction({ overlayOpen: false, presentation: "normal", fullscreen: false }),
    ).toBe("none");
  });

  it("uses narrow top and bottom edge zones", () => {
    expect(readerEdgeHotZone(8, 0, 800)).toBe("top");
    expect(readerEdgeHotZone(792, 0, 800)).toBe("bottom");
    expect(readerEdgeHotZone(20, 0, 800)).toBeNull();
    expect(readerEdgeHotZone(400, 0, 800)).toBeNull();
  });

  it("only auto-hides when every interaction guard is clear", () => {
    expect(canAutoHideChrome("normal", emptyChromeGuards)).toBe(false);
    expect(canAutoHideChrome("fullscreen", emptyChromeGuards)).toBe(true);
    expect(canAutoHideChrome("immersive", emptyChromeGuards)).toBe(true);
    expect(canAutoHideChrome("focus", emptyChromeGuards)).toBe(true);
    for (const key of Object.keys(emptyChromeGuards) as Array<keyof typeof emptyChromeGuards>) {
      expect(canAutoHideChrome("fullscreen", { ...emptyChromeGuards, [key]: true })).toBe(false);
    }
  });
});
