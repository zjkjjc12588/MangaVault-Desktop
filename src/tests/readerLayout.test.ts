import { describe, expect, it } from "vitest";
import { readerViewportSpacing, resolveReaderControlsLayout } from "../reader/readerLayout";

describe("reader controls layout", () => {
  it("resolves automatic layout by presentation", () => {
    expect(resolveReaderControlsLayout("auto", "normal")).toBe("reserved");
    expect(resolveReaderControlsLayout("auto", "fullscreen")).toBe("overlay");
    expect(resolveReaderControlsLayout("auto", "immersive")).toBe("overlay");
  });

  it("keeps explicit overlay and reserved layouts stable in every presentation", () => {
    for (const presentation of ["normal", "fullscreen", "immersive"] as const) {
      expect(resolveReaderControlsLayout("overlay", presentation)).toBe("overlay");
      expect(resolveReaderControlsLayout("reserved", presentation)).toBe("reserved");
    }
  });

  it("always overlays controls in focus reading without changing the saved preference", () => {
    expect(resolveReaderControlsLayout("reserved", "focus")).toBe("overlay");
    expect(resolveReaderControlsLayout("auto", "focus")).toBe("overlay");
  });

  it("uses fixed viewport spacing independent of toolbar visibility", () => {
    expect(readerViewportSpacing("reserved")).toBe("pb-16 pt-14");
    expect(readerViewportSpacing("overlay")).toBe("pb-0 pt-0");
  });
});
