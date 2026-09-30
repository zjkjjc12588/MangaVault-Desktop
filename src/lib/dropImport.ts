export function normalizeDroppedPaths(paths: readonly string[]): string[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}

export function browserDroppedPaths(
  files: readonly (File & { path?: string })[] | null | undefined,
): string[] {
  return normalizeDroppedPaths((files ?? []).map((file) => file.path ?? ""));
}

export function isFileDrag(types: readonly string[]): boolean {
  return types.includes("Files");
}
