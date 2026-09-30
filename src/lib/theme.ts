export type ThemePreference = "system" | "dark" | "light";

export function normalizeTheme(value: unknown): ThemePreference {
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

export function applyTheme(theme: ThemePreference): void {
  document.documentElement.classList.toggle("light", shouldUseLightTheme(theme));
}

export function shouldUseLightTheme(theme: ThemePreference): boolean {
  if (theme === "light") return true;
  if (theme === "dark") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}
