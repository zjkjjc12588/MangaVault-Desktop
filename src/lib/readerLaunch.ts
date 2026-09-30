import * as api from "./api";

export const READER_LAUNCH_STATE_KEY = "reader.launch_state";
export const READER_LAST_STABLE_STATE_KEY = "reader.last_stable_state";

export type ReaderLaunchPreference = "windowed" | "focus" | "remember";
export type StableReaderState = "windowed" | "focus";

export interface ReaderLaunchPreferences {
  launchState: ReaderLaunchPreference;
  lastStableState: StableReaderState;
}

const defaultPreferences: ReaderLaunchPreferences = {
  launchState: "windowed",
  lastStableState: "windowed",
};

let preferences = defaultPreferences;
const listeners = new Set<() => void>();

export function normalizeReaderLaunchPreference(value: unknown): ReaderLaunchPreference {
  return value === "focus" || value === "remember" ? value : "windowed";
}

export function normalizeStableReaderState(value: unknown): StableReaderState {
  return value === "focus" ? "focus" : "windowed";
}

export function syncReaderLaunchPreferences(settings: Record<string, unknown>): void {
  const next = {
    launchState: normalizeReaderLaunchPreference(settings[READER_LAUNCH_STATE_KEY]),
    lastStableState: normalizeStableReaderState(settings[READER_LAST_STABLE_STATE_KEY]),
  };
  if (
    next.launchState === preferences.launchState &&
    next.lastStableState === preferences.lastStableState
  ) {
    return;
  }
  preferences = next;
  listeners.forEach((listener) => listener());
}

export function getReaderLaunchPreferences(): ReaderLaunchPreferences {
  return preferences;
}

export function subscribeReaderLaunchPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resolveReaderLaunchTarget(
  value: ReaderLaunchPreferences = preferences,
): StableReaderState {
  if (value.launchState === "remember") return value.lastStableState;
  return value.launchState;
}

export async function persistStableReaderState(state: StableReaderState): Promise<void> {
  if (preferences.launchState !== "remember" || preferences.lastStableState === state) return;
  const previous = preferences;
  preferences = { ...preferences, lastStableState: state };
  listeners.forEach((listener) => listener());
  try {
    const settings = await api.setSetting(READER_LAST_STABLE_STATE_KEY, state);
    syncReaderLaunchPreferences(settings);
  } catch (error) {
    preferences = previous;
    listeners.forEach((listener) => listener());
    throw error;
  }
}

export function __resetReaderLaunchPreferencesForTests(): void {
  preferences = defaultPreferences;
  listeners.forEach((listener) => listener());
}
