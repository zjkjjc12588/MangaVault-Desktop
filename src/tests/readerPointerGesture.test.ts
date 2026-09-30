import { describe, expect, it } from "vitest";
import {
  beginReaderPointerGesture,
  expirePendingCenterClick,
  readerGestureRegion,
  resolveReaderPointerGesture,
  updateReaderPointerGesture,
  type PendingCenterClick,
  type ReaderGestureGuards,
  type ReaderGestureSettings,
} from "../reader/readerPointerGesture";

const guards: ReaderGestureGuards = {
  defaultPrevented: false,
  isInteractiveTarget: false,
  isOverlayOpen: false,
  isSelecting: false,
  isControlFocused: false,
  isDraggingControl: false,
  isInertialScrolling: false,
  isComposing: false,
  isPrimaryPointer: true,
};

const settings: ReaderGestureSettings = {
  direction: "ltr",
  mode: "single",
  sideClickPaging: true,
  centerClickControls: true,
  doubleClickZoom: true,
  doubleClickInterval: 350,
  dragPan: true,
  zoom: 100,
};

function begin(x: number, overrides: Partial<ReaderGestureSettings> = {}) {
  return beginReaderPointerGesture({
    pointerId: 7,
    pointerType: "mouse",
    clientX: x,
    clientY: 200,
    button: 0,
    time: 100,
    bounds: { left: 0, width: 1000 },
    settings: { ...settings, ...overrides },
    guards,
  });
}

function release(
  x: number,
  state = begin(x),
  options: {
    at?: number;
    pending?: PendingCenterClick | null;
    settings?: Partial<ReaderGestureSettings>;
    guards?: Partial<ReaderGestureGuards>;
  } = {},
) {
  return resolveReaderPointerGesture({
    state,
    pointerId: 7,
    position: { x, y: 200 },
    releasedAt: options.at ?? 150,
    settings: { ...settings, ...options.settings },
    guards: { ...guards, ...options.guards },
    pendingCenterClick: options.pending ?? null,
    nextPendingId: 2,
  });
}

describe("reader pointer gesture arbitration", () => {
  it("uses stable 30/40/30 regions", () => {
    expect(readerGestureRegion(299, 0, 1000)).toBe("left");
    expect(readerGestureRegion(300, 0, 1000)).toBe("center");
    expect(readerGestureRegion(700, 0, 1000)).toBe("center");
    expect(readerGestureRegion(701, 0, 1000)).toBe("right");
  });

  it("pages immediately in the side regions without creating a double-click pending action", () => {
    expect(release(100)).toEqual({ actions: ["previous"], pendingCenterClick: null });
    expect(release(900)).toEqual({ actions: ["next"], pendingCenterClick: null });
  });

  it("swaps side actions for RTL and never turns a rapid side double click into zoom", () => {
    const first = release(100, begin(100, { direction: "rtl" }), {
      settings: { direction: "rtl" },
    });
    const second = release(100, begin(100, { direction: "rtl" }), {
      at: 240,
      pending: first.pendingCenterClick,
      settings: { direction: "rtl" },
    });
    expect(first.actions).toEqual(["next"]);
    expect(second.actions).toEqual(["next"]);
  });

  it("delays one center click and executes it only when its own timer expires", () => {
    const first = release(500);
    expect(first.actions).toEqual([]);
    expect(expirePendingCenterClick(first.pendingCenterClick, 2).actions).toEqual([
      "toggle-controls",
    ]);
  });

  it.each([250, 350, 500] as const)(
    "recognizes one center double click at the %d ms setting without a preceding single action",
    (interval) => {
      const first = release(500, begin(500, { doubleClickInterval: interval }), {
        at: 100,
        settings: { doubleClickInterval: interval },
      });
      const second = release(505, begin(505, { doubleClickInterval: interval }), {
        at: 100 + interval,
        pending: first.pendingCenterClick,
        settings: { doubleClickInterval: interval },
      });
      expect(first.actions).toEqual([]);
      expect(second).toEqual({ actions: ["toggle-zoom"], pendingCenterClick: null });
    },
  );

  it("does not combine center clicks that are too far apart", () => {
    const first = release(450, begin(450), { at: 100 });
    const second = release(550, begin(550), { at: 200, pending: first.pendingCenterClick });
    expect(second.actions).toEqual(["toggle-controls"]);
    expect(second.pendingCenterClick?.position.x).toBe(550);
  });

  it("makes center clicks immediate when double-click zoom is disabled", () => {
    const state = begin(500, { doubleClickZoom: false });
    expect(release(500, state, { settings: { doubleClickZoom: false } })).toEqual({
      actions: ["toggle-controls"],
      pendingCenterClick: null,
    });
  });

  it("disables side page zones in continuous scroll while retaining center controls", () => {
    const side = release(100, begin(100, { mode: "scroll" }), { settings: { mode: "scroll" } });
    const center = release(500, begin(500, { mode: "scroll" }), {
      settings: { mode: "scroll" },
    });
    expect(side.actions).toEqual(["none"]);
    expect(center.actions).toEqual(["toggle-controls"]);
  });

  it("turns a zoomed movement into pan and never click", () => {
    const state = updateReaderPointerGesture(
      begin(500, { zoom: 200 }),
      { x: 540, y: 230 },
      {
        ...settings,
        zoom: 200,
      },
    );
    expect(release(540, state, { settings: { zoom: 200 } }).actions).toEqual(["pan"]);
  });

  it.each([
    ["interactive target", { isInteractiveTarget: true }],
    ["overlay", { isOverlayOpen: true }],
    ["selection", { isSelecting: true }],
    ["focused control", { isControlFocused: true }],
    ["control drag", { isDraggingControl: true }],
    ["inertial scrolling", { isInertialScrolling: true }],
    ["IME composition", { isComposing: true }],
  ] as const)("rejects gestures during %s", (_label, blockedGuard) => {
    const blocked = { ...guards, ...blockedGuard };
    const state = beginReaderPointerGesture({
      pointerId: 7,
      pointerType: "mouse",
      clientX: 100,
      clientY: 200,
      button: 0,
      time: 100,
      bounds: { left: 0, width: 1000 },
      settings,
      guards: blocked,
    });
    expect(release(100, state, { guards: blockedGuard }).actions).toEqual(["none"]);
  });
});
