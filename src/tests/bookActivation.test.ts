import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetBookActivationForTests,
  beginBookPointerGesture,
  getBookActivationState,
  getBookOpenMouseAction,
  isBookActionTarget,
  normalizeBookOpenMouseAction,
  pointerIntentFromClick,
  resolveBookActivationIntent,
  runBookActivation,
  syncBookActivationPreferences,
  updateBookPointerGesture,
} from "../library/bookActivation";

describe("book activation", () => {
  afterEach(() => __resetBookActivationForTests());

  it("defaults to desktop double-click and accepts a persisted single-click preference", () => {
    expect(normalizeBookOpenMouseAction(undefined)).toBe("double");
    expect(normalizeBookOpenMouseAction("unsupported")).toBe("double");
    syncBookActivationPreferences({ "library.open_mouse_action": "single" });
    expect(getBookOpenMouseAction()).toBe("single");
  });

  it("selects on the first desktop click and opens on the second in double-click mode", () => {
    expect(intent({ mode: "double", clickCount: 1 })).toBe("select");
    expect(intent({ mode: "double", clickCount: 2 })).toBe("open");
    expect(intent({ mode: "single", clickCount: 1 })).toBe("open");
  });

  it("opens touch and pen targets with one tap regardless of desktop preference", () => {
    expect(intent({ mode: "double", pointerType: "touch" })).toBe("open");
    expect(intent({ mode: "double", pointerType: "pen" })).toBe("open");
  });

  it("rejects child actions, non-primary buttons, dragging, long presses, and handled events", () => {
    expect(intent({ interactiveTarget: true })).toBe("none");
    expect(intent({ primaryButton: false })).toBe("none");
    expect(intent({ moved: true })).toBe("none");
    expect(intent({ longPress: true })).toBe("none");
    expect(intent({ defaultPrevented: true })).toBe("none");
  });

  it("uses semantic child controls rather than class-name checks", () => {
    const surface = document.createElement("div");
    const label = document.createElement("span");
    const button = document.createElement("button");
    surface.append(label, button);

    expect(isBookActionTarget(label, surface)).toBe(false);
    expect(isBookActionTarget(button, surface)).toBe(true);
  });

  it("suppresses activation after pointer movement or a long press", () => {
    const started = beginBookPointerGesture(
      {
        pointerId: 4,
        pointerType: "mouse",
        clientX: 10,
        clientY: 10,
        button: 0,
        isPrimary: true,
      },
      0,
    );
    const moved = updateBookPointerGesture(started, { pointerId: 4, clientX: 20, clientY: 10 });
    const surface = document.createElement("div");
    expect(
      pointerIntentFromClick(
        {
          detail: 1,
          button: 0,
          defaultPrevented: false,
          target: surface,
          currentTarget: surface,
        },
        moved,
        "single",
        100,
      ),
    ).toBe("none");
    expect(
      pointerIntentFromClick(
        {
          detail: 1,
          button: 0,
          defaultPrevented: false,
          target: surface,
          currentTarget: surface,
        },
        started,
        "single",
        700,
      ),
    ).toBe("none");
  });

  it("shares one opening task for repeated activation of the same book", async () => {
    const pending = deferred<void>();
    const task = vi.fn(() => pending.promise);
    const first = runBookActivation(7, task);
    const duplicate = await runBookActivation(7, task);

    expect(duplicate).toBe(false);
    expect(task).toHaveBeenCalledTimes(1);
    expect(getBookActivationState().openingBookId).toBe(7);
    pending.resolve();
    await expect(first).resolves.toBe(true);
    expect(getBookActivationState().openingBookId).toBeNull();
  });

  it("lets a later book invalidate an older opening generation", async () => {
    const stale = deferred<void>();
    const first = runBookActivation(1, () => stale.promise);
    await expect(runBookActivation(2, () => Promise.resolve())).resolves.toBe(true);
    stale.resolve();

    await expect(first).resolves.toBe(false);
    expect(getBookActivationState()).toEqual({ openingBookId: null, activationGeneration: 2 });
  });

  it("releases the opening gate after failure so the book can be retried", async () => {
    await expect(runBookActivation(5, () => Promise.reject(new Error("failed")))).rejects.toThrow(
      "failed",
    );
    expect(getBookActivationState().openingBookId).toBeNull();
    await expect(runBookActivation(5, () => Promise.resolve())).resolves.toBe(true);
  });
});

function intent(overrides: Partial<Parameters<typeof resolveBookActivationIntent>[0]> = {}) {
  return resolveBookActivationIntent({
    mode: "double",
    pointerType: "mouse",
    clickCount: 1,
    primaryButton: true,
    interactiveTarget: false,
    defaultPrevented: false,
    moved: false,
    longPress: false,
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
