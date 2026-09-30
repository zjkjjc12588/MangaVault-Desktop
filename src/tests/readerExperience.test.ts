import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock("../lib/api", () => api);

describe("reader experience preferences", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    api.getSettings.mockResolvedValue({});
    api.setSetting.mockResolvedValue({});
    const { __resetReaderExperienceForTests } = await import("../lib/readerExperience");
    __resetReaderExperienceForTests();
  });

  it("shares one settings request and caches the result for the session", async () => {
    api.getSettings.mockResolvedValue({
      "reader.tutorial_seen": true,
      "reader.fullscreen_hint_seen": false,
    });
    const { loadReaderExperience } = await import("../lib/readerExperience");

    const [first, second] = await Promise.all([loadReaderExperience(), loadReaderExperience()]);
    const third = await loadReaderExperience();

    expect(first).toEqual({ tutorialSeen: true, fullscreenHintSeen: false });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it("persists each one-time guide without a schema migration", async () => {
    const { loadReaderExperience, markFullscreenHintSeen, markReaderTutorialSeen } =
      await import("../lib/readerExperience");

    await loadReaderExperience();
    await markReaderTutorialSeen();
    await markFullscreenHintSeen();

    expect(api.setSetting).toHaveBeenNthCalledWith(1, "reader.tutorial_seen", true);
    expect(api.setSetting).toHaveBeenNthCalledWith(2, "reader.fullscreen_hint_seen", true);
    await expect(loadReaderExperience()).resolves.toEqual({
      tutorialSeen: true,
      fullscreenHintSeen: true,
    });
  });

  it("merges concurrent guide acknowledgements without losing either flag", async () => {
    const { loadReaderExperience, markFullscreenHintSeen, markReaderTutorialSeen } =
      await import("../lib/readerExperience");

    await Promise.all([markReaderTutorialSeen(), markFullscreenHintSeen()]);

    await expect(loadReaderExperience()).resolves.toEqual({
      tutorialSeen: true,
      fullscreenHintSeen: true,
    });
  });
});
