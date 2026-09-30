import * as api from "./api";

const READER_TUTORIAL_SEEN = "reader.tutorial_seen";
const FULLSCREEN_HINT_SEEN = "reader.fullscreen_hint_seen";

export interface ReaderExperiencePreferences {
  tutorialSeen: boolean;
  fullscreenHintSeen: boolean;
}

let cachedPreferences: ReaderExperiencePreferences | undefined;
let preferencesInFlight: Promise<ReaderExperiencePreferences> | undefined;

export function loadReaderExperience(): Promise<ReaderExperiencePreferences> {
  if (cachedPreferences) return Promise.resolve(cachedPreferences);
  if (preferencesInFlight) return preferencesInFlight;
  const request = api
    .getSettings()
    .then((settings) => {
      cachedPreferences = {
        tutorialSeen: settings[READER_TUTORIAL_SEEN] === true,
        fullscreenHintSeen: settings[FULLSCREEN_HINT_SEEN] === true,
      };
      return cachedPreferences;
    })
    .finally(() => {
      if (preferencesInFlight === request) preferencesInFlight = undefined;
    });
  preferencesInFlight = request;
  return request;
}

export async function markReaderTutorialSeen(): Promise<void> {
  const current = await loadReaderExperience();
  cachedPreferences = { ...(cachedPreferences ?? current), tutorialSeen: true };
  await api.setSetting(READER_TUTORIAL_SEEN, true);
}

export async function markFullscreenHintSeen(): Promise<void> {
  const current = await loadReaderExperience();
  cachedPreferences = { ...(cachedPreferences ?? current), fullscreenHintSeen: true };
  await api.setSetting(FULLSCREEN_HINT_SEEN, true);
}

export function __resetReaderExperienceForTests(): void {
  cachedPreferences = undefined;
  preferencesInFlight = undefined;
}
