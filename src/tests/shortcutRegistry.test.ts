import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetShortcutRegistryForTests,
  addShortcutBinding,
  bindingsEqual,
  dispatchShortcutKeyboardEvent,
  effectiveShortcutBindings,
  exportShortcutUserBindings,
  findShortcutConflicts,
  formatShortcutBinding,
  getShortcutRegistrySnapshot,
  registerShortcutHandler,
  removeShortcutBinding,
  resetAllShortcutCommands,
  resetShortcutCommand,
  shortcutBindingFromEvent,
  syncShortcutBindings,
  validateShortcutBinding,
} from "../shortcuts/shortcutRegistry";

describe("shortcut registry", () => {
  beforeEach(() => __resetShortcutRegistryForTests());

  it("loads unique default commands with multiple page bindings", () => {
    const commands = getShortcutRegistrySnapshot().commands;
    expect(new Set(commands.map((command) => command.commandId)).size).toBe(commands.length);
    expect(
      effectiveShortcutBindings("reader.nextPage").map((binding) => binding.normalizedKey),
    ).toEqual(["ArrowRight", "Space", "PageDown"]);
  });

  it("adds, removes, resets one command, and resets all commands", () => {
    const extra = keyEvent("n", "KeyN", { ctrlKey: true });
    const binding = shortcutBindingFromEvent(extra)!;
    addShortcutBinding("reader.nextPage", binding);
    expect(effectiveShortcutBindings("reader.nextPage")).toContainEqual(binding);

    removeShortcutBinding("reader.nextPage", binding);
    expect(effectiveShortcutBindings("reader.nextPage")).not.toContainEqual(binding);
    addShortcutBinding("reader.nextPage", binding);
    resetShortcutCommand("reader.nextPage");
    expect(effectiveShortcutBindings("reader.nextPage")).toHaveLength(3);

    addShortcutBinding("reader.bookmark", binding);
    resetAllShortcutCommands();
    expect(exportShortcutUserBindings()).toEqual({});
  });

  it("persists overrides and restores them after a registry reset", () => {
    const binding = shortcutBindingFromEvent(keyEvent("n", "KeyN", { altKey: true }))!;
    addShortcutBinding("reader.bookmark", binding);
    const persisted = exportShortcutUserBindings();

    __resetShortcutRegistryForTests();
    syncShortcutBindings(persisted);

    expect(effectiveShortcutBindings("reader.bookmark")).toContainEqual(binding);
  });

  it("detects overlapping conflicts but permits mutually exclusive library and reader scopes", () => {
    const readerBinding = effectiveShortcutBindings("reader.bookmark")[0];
    expect(findShortcutConflicts("reader.fullscreen", readerBinding)).toEqual(
      expect.arrayContaining([expect.objectContaining({ commandId: "reader.bookmark" })]),
    );
    expect(findShortcutConflicts("library.importFolder", readerBinding)).toEqual([]);
  });

  it("replaces a conflicting binding only after explicit confirmation", () => {
    const binding = effectiveShortcutBindings("reader.bookmark")[0];
    expect(() => addShortcutBinding("reader.fullscreen", binding)).toThrow("shortcut-conflict");

    addShortcutBinding("reader.fullscreen", binding, true);
    expect(effectiveShortcutBindings("reader.fullscreen")).toContainEqual(binding);
    expect(effectiveShortcutBindings("reader.bookmark")).not.toContainEqual(binding);
  });

  it("keeps Escape safety bindings immutable and non-empty", () => {
    const escape = effectiveShortcutBindings("reader.escapePresentation")[0];
    expect(validateShortcutBinding(escape)).toBe("escape-reserved");
    expect(() => removeShortcutBinding("reader.escapePresentation", escape)).toThrow(
      "shortcut-command-locked",
    );
    syncShortcutBindings({ "reader.escapePresentation": [] });
    expect(effectiveShortcutBindings("reader.escapePresentation")).toEqual([escape]);
  });

  it("rejects unsafe bindings even when persisted settings are manually corrupted", () => {
    const escape = shortcutBindingFromEvent(keyEvent("Escape", "Escape"))!;
    const closeWindow = shortcutBindingFromEvent(keyEvent("F4", "F4", { altKey: true }))!;

    syncShortcutBindings({
      "reader.bookmark": [escape, closeWindow],
    });

    expect(
      effectiveShortcutBindings("reader.bookmark").map((binding) => binding.normalizedKey),
    ).toEqual(["b"]);
  });

  it("does not execute reader commands in inputs or during IME composition", () => {
    const handler = vi.fn(() => true);
    const unregister = registerShortcutHandler("reader.bookmark", handler);
    const input = document.createElement("input");

    expect(dispatchShortcutKeyboardEvent(keyEvent("b", "KeyB", {}, input))).toBe(false);
    expect(dispatchShortcutKeyboardEvent(keyEvent("b", "KeyB", { isComposing: true }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    unregister();
  });

  it("does not misread AltGraph text input as a Ctrl+Alt shortcut", () => {
    const handler = vi.fn(() => true);
    const unregister = registerShortcutHandler("reader.bookmark", handler);
    const event = keyEvent("b", "KeyB", { ctrlKey: true, altKey: true });
    Object.defineProperty(event, "getModifierState", {
      configurable: true,
      value: (modifier: string) => modifier === "AltGraph",
    });

    expect(dispatchShortcutKeyboardEvent(event)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    unregister();
  });

  it("honors automatic repeat policy and prevents default only after execution", () => {
    const next = vi.fn(() => true);
    const fullscreen = vi.fn(() => true);
    const unregisterNext = registerShortcutHandler("reader.nextPage", next);
    const unregisterFullscreen = registerShortcutHandler("reader.fullscreen", fullscreen);
    const repeatedNext = keyEvent("ArrowRight", "ArrowRight", { repeat: true });
    const repeatedFullscreen = keyEvent("f", "KeyF", { repeat: true });
    const missing = keyEvent("x", "KeyX");

    expect(dispatchShortcutKeyboardEvent(repeatedNext)).toBe(true);
    expect(repeatedNext.defaultPrevented).toBe(true);
    expect(dispatchShortcutKeyboardEvent(repeatedFullscreen)).toBe(false);
    expect(repeatedFullscreen.defaultPrevented).toBe(false);
    expect(dispatchShortcutKeyboardEvent(missing)).toBe(false);
    expect(missing.defaultPrevented).toBe(false);
    unregisterNext();
    unregisterFullscreen();
  });

  it("normalizes case, distinguishes modifiers, and identifies numeric keypad keys", () => {
    const lower = shortcutBindingFromEvent(keyEvent("b", "KeyB"))!;
    const upper = shortcutBindingFromEvent(keyEvent("B", "KeyB", { shiftKey: true }))!;
    const ctrl = shortcutBindingFromEvent(keyEvent("b", "KeyB", { ctrlKey: true }))!;
    const ctrlShift = shortcutBindingFromEvent(
      keyEvent("B", "KeyB", { ctrlKey: true, shiftKey: true }),
    )!;
    const numpad = shortcutBindingFromEvent(keyEvent("1", "Numpad1"))!;

    expect(lower.normalizedKey).toBe("b");
    expect(upper.normalizedKey).toBe("b");
    expect(bindingsEqual(ctrl, ctrlShift)).toBe(false);
    expect(numpad.normalizedKey).toBe("Numpad1");
  });

  it("formats the primary modifier for Windows and macOS", () => {
    const primary = effectiveShortcutBindings("global.commandPalette")[0];
    expect(formatShortcutBinding(primary, "windows")).toBe("Ctrl+K");
    expect(formatShortcutBinding(primary, "mac")).toBe("Cmd+K");
  });

  it("executes only the latest runtime handler for one command", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const unregisterFirst = registerShortcutHandler("reader.bookmark", first);
    const unregisterSecond = registerShortcutHandler("reader.bookmark", second);

    dispatchShortcutKeyboardEvent(keyEvent("b", "KeyB"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unregisterSecond();
    unregisterFirst();
  });
});

function keyEvent(
  key: string,
  code: string,
  init: ConstructorParameters<typeof globalThis.KeyboardEvent>[1] = {},
  target: unknown = null,
): KeyboardEvent {
  const event = new globalThis.KeyboardEvent("keydown", { key, code, cancelable: true, ...init });
  if (target) Object.defineProperty(event, "target", { configurable: true, value: target });
  return event;
}
