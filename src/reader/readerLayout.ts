import type { ReaderControlsLayout } from "../lib/types";
import type { ReaderPresentation } from "../lib/readerPresentation";

export type ResolvedReaderControlsLayout = "overlay" | "reserved";

export function resolveReaderControlsLayout(
  preference: ReaderControlsLayout,
  presentation: ReaderPresentation,
): ResolvedReaderControlsLayout {
  if (presentation === "focus") return "overlay";
  if (preference === "overlay") return "overlay";
  if (preference === "reserved") return "reserved";
  return presentation === "normal" ? "reserved" : "overlay";
}

export function readerViewportSpacing(layout: ResolvedReaderControlsLayout): string {
  return layout === "reserved" ? "pb-16 pt-14" : "pb-0 pt-0";
}
