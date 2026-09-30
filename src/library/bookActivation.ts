import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

export const BOOK_OPEN_MOUSE_ACTION_KEY = "library.open_mouse_action";
export type BookOpenMouseAction = "double" | "single";

export interface BookActivationState {
  openingBookId: number | null;
  activationGeneration: number;
}

export type BookActivationIntent = "none" | "select" | "open";

export interface BookActivationIntentInput {
  mode: BookOpenMouseAction;
  pointerType: string;
  clickCount: number;
  primaryButton: boolean;
  interactiveTarget: boolean;
  defaultPrevented: boolean;
  moved: boolean;
  longPress: boolean;
}

export interface PointerActivationSnapshot {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
  primaryButton: boolean;
}

export const BOOK_ACTIVATION_DRAG_THRESHOLD_PX = 6;
export const BOOK_ACTIVATION_LONG_PRESS_MS = 600;

let currentPreferences: BookOpenMouseAction = "double";
const preferenceListeners = new Set<() => void>();

let activationState: BookActivationState = {
  openingBookId: null,
  activationGeneration: 0,
};
const activationListeners = new Set<() => void>();

export function normalizeBookOpenMouseAction(value: unknown): BookOpenMouseAction {
  return value === "single" ? "single" : "double";
}

export function syncBookActivationPreferences(values: Record<string, unknown>): void {
  const next = normalizeBookOpenMouseAction(values[BOOK_OPEN_MOUSE_ACTION_KEY]);
  if (next === currentPreferences) return;
  currentPreferences = next;
  preferenceListeners.forEach((listener) => listener());
}

export function getBookOpenMouseAction(): BookOpenMouseAction {
  return currentPreferences;
}

export function subscribeBookActivationPreferences(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => preferenceListeners.delete(listener);
}

export function getBookActivationState(): BookActivationState {
  return activationState;
}

export function subscribeBookActivationState(listener: () => void): () => void {
  activationListeners.add(listener);
  return () => activationListeners.delete(listener);
}

export async function runBookActivation(
  bookId: number,
  task: (generation: number) => Promise<void> | void,
): Promise<boolean> {
  if (activationState.openingBookId === bookId) return false;
  const generation = activationState.activationGeneration + 1;
  publishActivationState({ openingBookId: bookId, activationGeneration: generation });
  try {
    await task(generation);
    return generation === activationState.activationGeneration;
  } finally {
    if (generation === activationState.activationGeneration) {
      publishActivationState({ openingBookId: null, activationGeneration: generation });
    }
  }
}

export function resolveBookActivationIntent({
  mode,
  pointerType,
  clickCount,
  primaryButton,
  interactiveTarget,
  defaultPrevented,
  moved,
  longPress,
}: BookActivationIntentInput): BookActivationIntent {
  if (!primaryButton || interactiveTarget || defaultPrevented || moved || longPress) return "none";
  if (pointerType === "touch" || pointerType === "pen") return clickCount === 1 ? "open" : "none";
  if (mode === "single") return clickCount === 1 ? "open" : "none";
  if (clickCount >= 2) return "open";
  return "select";
}

export function beginBookPointerGesture(
  event: Pick<
    ReactPointerEvent<HTMLElement>,
    "pointerId" | "pointerType" | "clientX" | "clientY" | "button" | "isPrimary"
  >,
  startedAt = Date.now(),
): PointerActivationSnapshot | null {
  if (!event.isPrimary || event.button !== 0) return null;
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType || "mouse",
    startX: event.clientX,
    startY: event.clientY,
    startedAt,
    moved: false,
    primaryButton: true,
  };
}

export function updateBookPointerGesture(
  snapshot: PointerActivationSnapshot | null,
  event: Pick<ReactPointerEvent<HTMLElement>, "pointerId" | "clientX" | "clientY">,
): PointerActivationSnapshot | null {
  if (!snapshot || snapshot.pointerId !== event.pointerId || snapshot.moved) return snapshot;
  const distance = Math.hypot(event.clientX - snapshot.startX, event.clientY - snapshot.startY);
  return distance > BOOK_ACTIVATION_DRAG_THRESHOLD_PX ? { ...snapshot, moved: true } : snapshot;
}

export function pointerIntentFromClick(
  event: Pick<
    ReactMouseEvent<HTMLElement>,
    "detail" | "button" | "defaultPrevented" | "target" | "currentTarget"
  >,
  snapshot: PointerActivationSnapshot | null,
  mode: BookOpenMouseAction,
  now = Date.now(),
): BookActivationIntent {
  return resolveBookActivationIntent({
    mode,
    pointerType: snapshot?.pointerType ?? "mouse",
    clickCount: Math.max(1, event.detail),
    primaryButton: event.button === 0 && (snapshot?.primaryButton ?? true),
    interactiveTarget: isBookActionTarget(event.target, event.currentTarget),
    defaultPrevented: event.defaultPrevented,
    moved: snapshot?.moved ?? false,
    longPress: snapshot ? now - snapshot.startedAt >= BOOK_ACTIVATION_LONG_PRESS_MS : false,
  });
}

export function isBookActionTarget(target: unknown, surface: unknown): boolean {
  if (!(target instanceof globalThis.Element) || !(surface instanceof globalThis.Element)) {
    return false;
  }
  const action = target.closest(
    "button, a, input, select, textarea, [contenteditable='true'], [data-book-action], [role='menuitem'], [role='checkbox'], [role='slider']",
  );
  return action !== null && action !== surface;
}

export function __resetBookActivationForTests(): void {
  currentPreferences = "double";
  activationState = { openingBookId: null, activationGeneration: 0 };
  preferenceListeners.clear();
  activationListeners.clear();
}

function publishActivationState(next: BookActivationState): void {
  activationState = next;
  activationListeners.forEach((listener) => listener());
}
