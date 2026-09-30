import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_ADJUSTMENTS, hasImageAdjustments } from "../lib/readerImageSettings";
import type { ReaderSettings } from "../lib/types";

const settings: ReaderSettings = {
  mode: "double",
  direction: "rtl",
  fit: "height",
  zoom: 125,
  background: "#0b0f14",
  brightness: 100,
  contrast: 100,
  saturation: 100,
  rotation: 0,
  grayscale: false,
  sharpen: false,
  trimWhite: false,
  coverSingle: true,
  preferEnhanced: true,
  night: false,
  lowMemory: false,
  controlsLayout: "auto",
  sideClickPaging: true,
  centerClickControls: true,
  doubleClickZoom: true,
  doubleClickInterval: 350,
  ctrlWheelZoom: true,
  wheelPageTurn: true,
  dragPan: true,
};

describe("reader image adjustment defaults", () => {
  it("ignores page layout and reading behavior settings", () => {
    expect(hasImageAdjustments(settings)).toBe(false);
    expect({ ...settings, ...DEFAULT_IMAGE_ADJUSTMENTS }).toMatchObject({
      mode: "double",
      direction: "rtl",
      fit: "height",
      zoom: 125,
      coverSingle: true,
    });
  });

  it("detects normal adjustments and the legacy invert compatibility value", () => {
    expect(hasImageAdjustments({ ...settings, brightness: 90 })).toBe(true);
    expect(hasImageAdjustments({ ...settings, background: "#111111" })).toBe(true);
    expect(hasImageAdjustments({ ...settings, night: true })).toBe(true);
  });

  it("resets legacy invert together with image-only values", () => {
    const adjusted = {
      ...settings,
      brightness: 75,
      rotation: 270,
      night: true,
    };
    const reset = {
      ...adjusted,
      ...DEFAULT_IMAGE_ADJUSTMENTS,
    };
    expect(reset.night).toBe(false);
    expect(reset.brightness).toBe(100);
    expect(reset.rotation).toBe(0);
    expect(reset.mode).toBe("double");
    expect(reset.direction).toBe("rtl");
  });
});
