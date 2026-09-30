import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  setSetting: vi.fn(),
}));

vi.mock("../lib/api", () => api);

describe("reader launch preferences", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    api.setSetting.mockResolvedValue({
      "reader.launch_state": "remember",
      "reader.last_stable_state": "focus",
    });
    const { __resetReaderLaunchPreferencesForTests } = await import("../lib/readerLaunch");
    __resetReaderLaunchPreferencesForTests();
  });

  it("defaults to a normal window and accepts only supported values", async () => {
    const {
      getReaderLaunchPreferences,
      normalizeReaderLaunchPreference,
      normalizeStableReaderState,
    } = await import("../lib/readerLaunch");

    expect(getReaderLaunchPreferences()).toEqual({
      launchState: "windowed",
      lastStableState: "windowed",
    });
    expect(normalizeReaderLaunchPreference("focus")).toBe("focus");
    expect(normalizeReaderLaunchPreference("fullscreen")).toBe("windowed");
    expect(normalizeStableReaderState("focus")).toBe("focus");
    expect(normalizeStableReaderState("menu-open")).toBe("windowed");
  });

  it("resolves remember from the last stable state without preserving transient UI", async () => {
    const { resolveReaderLaunchTarget, syncReaderLaunchPreferences } =
      await import("../lib/readerLaunch");

    syncReaderLaunchPreferences({
      "reader.launch_state": "remember",
      "reader.last_stable_state": "focus",
      "reader.overlay": "thumbnails",
      "reader.chrome": "hidden",
    });

    expect(resolveReaderLaunchTarget()).toBe("focus");
  });

  it("persists stable state only when remember is selected", async () => {
    const { getReaderLaunchPreferences, persistStableReaderState, syncReaderLaunchPreferences } =
      await import("../lib/readerLaunch");

    await persistStableReaderState("focus");
    expect(api.setSetting).not.toHaveBeenCalled();

    syncReaderLaunchPreferences({
      "reader.launch_state": "remember",
      "reader.last_stable_state": "windowed",
    });
    await persistStableReaderState("focus");

    expect(api.setSetting).toHaveBeenCalledWith("reader.last_stable_state", "focus");
    expect(getReaderLaunchPreferences().lastStableState).toBe("focus");
  });

  it("rolls back an optimistic stable-state write when persistence fails", async () => {
    const { getReaderLaunchPreferences, persistStableReaderState, syncReaderLaunchPreferences } =
      await import("../lib/readerLaunch");
    syncReaderLaunchPreferences({
      "reader.launch_state": "remember",
      "reader.last_stable_state": "windowed",
    });
    api.setSetting.mockRejectedValueOnce(new Error("disk full"));

    await expect(persistStableReaderState("focus")).rejects.toThrow("disk full");
    expect(getReaderLaunchPreferences().lastStableState).toBe("windowed");
  });
});
