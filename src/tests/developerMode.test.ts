import { describe, expect, it } from "vitest";
import { developerResources, normalizeDeveloperModeSettings } from "../lib/developerMode";

describe("developer mode registry", () => {
  it("keeps developer resource identifiers unique", () => {
    const ids = new Set(developerResources.map((resource) => resource.id));

    expect(ids.size).toBe(developerResources.length);
    expect(developerResources.map((resource) => resource.path)).toContain(
      "docs/developer/PROVIDERS.md",
    );
    expect(developerResources.map((resource) => resource.path)).toContain(
      "plugins/examples/manifest.example.json",
    );
  });

  it("keeps diagnostics disabled by default", () => {
    expect(normalizeDeveloperModeSettings({})).toEqual({
      enabled: false,
      commandDebuggerEnabled: false,
      profilerEnabled: false,
      databaseBrowserEnabled: false,
    });
  });
});
