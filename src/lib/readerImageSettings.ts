import type { ReaderSettings } from "./types";

export const DEFAULT_IMAGE_ADJUSTMENTS = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  rotation: 0,
  grayscale: false,
  night: false,
  sharpen: false,
  trimWhite: false,
  background: "#0b0f14",
} satisfies Partial<ReaderSettings>;

export function hasImageAdjustments(settings: ReaderSettings): boolean {
  return Object.entries(DEFAULT_IMAGE_ADJUSTMENTS).some(
    ([key, value]) => settings[key as keyof ReaderSettings] !== value,
  );
}
