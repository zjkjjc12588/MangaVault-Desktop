export type ReaderPresentation = "normal" | "fullscreen" | "immersive" | "focus";

let presentation: ReaderPresentation = "normal";
const listeners = new Set<() => void>();

export function getReaderPresentation(): ReaderPresentation {
  return presentation;
}

export function setReaderPresentation(next: ReaderPresentation): void {
  if (presentation === next) return;
  presentation = next;
  listeners.forEach((listener) => listener());
}

export function subscribeReaderPresentation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function __resetReaderPresentationForTests(): void {
  setReaderPresentation("normal");
}
