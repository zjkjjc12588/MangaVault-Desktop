import type { ReaderDirection, ReaderMode } from "../lib/types";

export type ReaderGestureRegion = "left" | "center" | "right" | "outside";
export type ReaderGestureAction =
  "previous" | "next" | "toggle-controls" | "toggle-zoom" | "pan" | "none";

export interface ReaderPointerPosition {
  x: number;
  y: number;
}

export interface ReaderPointerGestureState {
  pointerId: number;
  pointerType: string;
  pointerDownPosition: ReaderPointerPosition;
  pointerUpPosition: ReaderPointerPosition | null;
  movementDistance: number;
  pointerDownTime: number;
  clickRegion: ReaderGestureRegion;
  clickCount: number;
  doubleClickEnabled: boolean;
  doubleClickInterval: 250 | 350 | 500;
  isDragging: boolean;
  isSelecting: boolean;
  isOverlayOpen: boolean;
  isInteractiveTarget: boolean;
  currentReaderMode: ReaderMode;
  button: number;
  eligible: boolean;
}

export interface PendingCenterClick {
  id: number;
  position: ReaderPointerPosition;
  pointerType: string;
  button: number;
  releasedAt: number;
}

export interface ReaderGestureSettings {
  direction: ReaderDirection;
  mode: ReaderMode;
  sideClickPaging: boolean;
  centerClickControls: boolean;
  doubleClickZoom: boolean;
  doubleClickInterval: 250 | 350 | 500;
  dragPan: boolean;
  zoom: number;
}

export interface ReaderGestureGuards {
  defaultPrevented: boolean;
  isInteractiveTarget: boolean;
  isOverlayOpen: boolean;
  isSelecting: boolean;
  isControlFocused: boolean;
  isDraggingControl: boolean;
  isInertialScrolling: boolean;
  isComposing: boolean;
  isPrimaryPointer: boolean;
}

export interface ReaderGestureResolution {
  actions: ReaderGestureAction[];
  pendingCenterClick: PendingCenterClick | null;
}

export const READER_GESTURE_DRAG_THRESHOLD_PX = 8;
export const READER_DOUBLE_CLICK_DISTANCE_PX = 24;

export function readerGestureRegion(
  clientX: number,
  left: number,
  width: number,
): ReaderGestureRegion {
  if (width <= 0) return "outside";
  const ratio = (clientX - left) / width;
  if (ratio < 0 || ratio > 1) return "outside";
  if (ratio < 0.3) return "left";
  if (ratio <= 0.7) return "center";
  return "right";
}

export function beginReaderPointerGesture({
  pointerId,
  pointerType,
  clientX,
  clientY,
  button,
  time,
  bounds,
  settings,
  guards,
}: {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button: number;
  time: number;
  bounds: { left: number; width: number };
  settings: ReaderGestureSettings;
  guards: ReaderGestureGuards;
}): ReaderPointerGestureState {
  const clickRegion = readerGestureRegion(clientX, bounds.left, bounds.width);
  return {
    pointerId,
    pointerType,
    pointerDownPosition: { x: clientX, y: clientY },
    pointerUpPosition: null,
    movementDistance: 0,
    pointerDownTime: time,
    clickRegion,
    clickCount: 1,
    doubleClickEnabled: settings.doubleClickZoom,
    doubleClickInterval: settings.doubleClickInterval,
    isDragging: false,
    isSelecting: guards.isSelecting,
    isOverlayOpen: guards.isOverlayOpen,
    isInteractiveTarget: guards.isInteractiveTarget,
    currentReaderMode: settings.mode,
    button,
    eligible:
      button === 0 &&
      guards.isPrimaryPointer &&
      !guards.defaultPrevented &&
      !guards.isInteractiveTarget &&
      !guards.isOverlayOpen &&
      !guards.isSelecting &&
      !guards.isControlFocused &&
      !guards.isDraggingControl &&
      !guards.isInertialScrolling &&
      !guards.isComposing &&
      clickRegion !== "outside",
  };
}

export function updateReaderPointerGesture(
  state: ReaderPointerGestureState,
  position: ReaderPointerPosition,
  settings: ReaderGestureSettings,
): ReaderPointerGestureState {
  const movementDistance = distance(state.pointerDownPosition, position);
  return {
    ...state,
    movementDistance,
    isDragging:
      state.isDragging ||
      (settings.dragPan &&
        settings.zoom > 100 &&
        movementDistance > READER_GESTURE_DRAG_THRESHOLD_PX),
  };
}

export function resolveReaderPointerGesture({
  state,
  pointerId,
  position,
  releasedAt,
  settings,
  guards,
  pendingCenterClick,
  nextPendingId,
}: {
  state: ReaderPointerGestureState;
  pointerId: number;
  position: ReaderPointerPosition;
  releasedAt: number;
  settings: ReaderGestureSettings;
  guards: ReaderGestureGuards;
  pendingCenterClick: PendingCenterClick | null;
  nextPendingId: number;
}): ReaderGestureResolution {
  const updated = updateReaderPointerGesture(state, position, settings);
  updated.pointerUpPosition = position;
  if (
    pointerId !== state.pointerId ||
    !state.eligible ||
    !guards.isPrimaryPointer ||
    guards.defaultPrevented ||
    guards.isInteractiveTarget ||
    guards.isOverlayOpen ||
    guards.isSelecting ||
    guards.isControlFocused ||
    guards.isDraggingControl ||
    guards.isInertialScrolling ||
    guards.isComposing
  ) {
    return { actions: ["none"], pendingCenterClick };
  }
  if (updated.movementDistance > READER_GESTURE_DRAG_THRESHOLD_PX) {
    return { actions: [updated.isDragging ? "pan" : "none"], pendingCenterClick };
  }
  if (state.clickRegion === "left" || state.clickRegion === "right") {
    if (!settings.sideClickPaging || settings.mode === "scroll") {
      return { actions: ["none"], pendingCenterClick };
    }
    return {
      actions: [sidePageAction(state.clickRegion, settings.direction)],
      pendingCenterClick,
    };
  }
  if (state.clickRegion !== "center" || !settings.centerClickControls) {
    return { actions: ["none"], pendingCenterClick };
  }
  if (!settings.doubleClickZoom || settings.mode === "scroll") {
    return { actions: ["toggle-controls"], pendingCenterClick: null };
  }

  const matchesPending =
    pendingCenterClick !== null &&
    pendingCenterClick.pointerType === state.pointerType &&
    pendingCenterClick.button === state.button &&
    releasedAt - pendingCenterClick.releasedAt <= settings.doubleClickInterval &&
    distance(pendingCenterClick.position, position) <= READER_DOUBLE_CLICK_DISTANCE_PX;
  if (matchesPending) {
    return { actions: ["toggle-zoom"], pendingCenterClick: null };
  }

  const nextPending: PendingCenterClick = {
    id: nextPendingId,
    position,
    pointerType: state.pointerType,
    button: state.button,
    releasedAt,
  };
  return {
    actions: pendingCenterClick ? ["toggle-controls"] : [],
    pendingCenterClick: nextPending,
  };
}

export function expirePendingCenterClick(
  pendingCenterClick: PendingCenterClick | null,
  pendingId: number,
): ReaderGestureResolution {
  if (!pendingCenterClick || pendingCenterClick.id !== pendingId) {
    return { actions: [], pendingCenterClick };
  }
  return { actions: ["toggle-controls"], pendingCenterClick: null };
}

function sidePageAction(region: "left" | "right", direction: ReaderDirection): "previous" | "next" {
  if (region === "left") return direction === "rtl" ? "next" : "previous";
  return direction === "rtl" ? "previous" : "next";
}

function distance(left: ReaderPointerPosition, right: ReaderPointerPosition): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}
