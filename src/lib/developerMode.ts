export interface DeveloperResource {
  id: string;
  label: Record<"zh" | "en", string>;
  kind: "documentation" | "example" | "decision";
  path: string;
}

export interface DeveloperModeSettings {
  enabled: boolean;
  commandDebuggerEnabled: boolean;
  profilerEnabled: boolean;
  databaseBrowserEnabled: boolean;
}

export const developerResources: DeveloperResource[] = [
  {
    id: "developer.providers",
    label: { zh: "提供方 API 文档", en: "Provider API docs" },
    kind: "documentation",
    path: "docs/developer/PROVIDERS.md",
  },
  {
    id: "developer.pluginManifest",
    label: { zh: "插件清单文档", en: "Plugin manifest docs" },
    kind: "documentation",
    path: "docs/developer/PLUGIN_MANIFEST.md",
  },
  {
    id: "developer.pluginExample",
    label: { zh: "插件清单示例", en: "Example plugin manifest" },
    kind: "example",
    path: "plugins/examples/manifest.example.json",
  },
  {
    id: "developer.extensionAdr",
    label: { zh: "扩展边界架构决策", en: "Extension boundary ADR" },
    kind: "decision",
    path: "docs/adr/0001-extension-boundaries.md",
  },
];

export function normalizeDeveloperModeSettings(
  settings: Record<string, unknown>,
): DeveloperModeSettings {
  return {
    enabled: settings["features.developer.enabled"] === true,
    commandDebuggerEnabled: settings["developer.command_debugger.enabled"] === true,
    profilerEnabled: settings["developer.profiler.enabled"] === true,
    databaseBrowserEnabled: settings["developer.database_browser.enabled"] === true,
  };
}
