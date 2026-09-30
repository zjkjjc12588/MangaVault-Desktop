import {
  AlertTriangle,
  BookOpen,
  Check,
  Database,
  FileSearch,
  FolderOpen,
  Gauge,
  Languages,
  LayoutGrid,
  Link2,
  Monitor,
  Moon,
  MousePointerClick,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ShortcutSettingsPanel } from "../components/settings/ShortcutSettingsPanel";
import { Button } from "../components/ui/Button";
import * as api from "../lib/api";
import { cn } from "../lib/cn";
import { normalizeDeveloperModeSettings } from "../lib/developerMode";
import { displayPath, formatBytes, formatDateTime } from "../lib/format";
import { formatUserError, normalizeLocale, setUiLocale, type Locale } from "../lib/i18n";
import { normalizeLayoutSettings, syncLayoutSettings } from "../lib/navigation";
import {
  READER_LAUNCH_STATE_KEY,
  normalizeReaderLaunchPreference,
  syncReaderLaunchPreferences,
} from "../lib/readerLaunch";
import { applyTheme, normalizeTheme, type ThemePreference } from "../lib/theme";
import {
  BOOK_OPEN_MOUSE_ACTION_KEY,
  normalizeBookOpenMouseAction,
  syncBookActivationPreferences,
} from "../library/bookActivation";
import {
  localizeSettingsText,
  normalizeSettingsSection,
  searchSettings,
  settingsSections,
  type SettingsSearchResult,
  type SettingsSectionId,
} from "../settings/settingsRegistry";
import { SHORTCUT_SETTINGS_KEY, syncShortcutBindings } from "../shortcuts/shortcutRegistry";
import { useReaderStore } from "../stores/readerStore";
import { useToastStore } from "../stores/toastStore";
import type {
  BackupSnapshot,
  DatabaseHealth,
  DatabaseResetSchedule,
  DatabaseRestoreStatus,
  DeletedBookCleanupPreview,
  FormatCapability,
  Library,
  LibraryRemovalPreview,
  LogFileInfo,
  JmComicMatchPreview,
  ExternalIdentityImportResult,
  JmComicProviderStatus,
  MetadataBatchPreview,
  MetadataBatchResult,
  JmComicSourceCandidate,
  StartupDataStatus,
  UpdateStatus,
} from "../lib/types";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedResult, setSelectedResult] = useState(0);
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [formatCapabilities, setFormatCapabilities] = useState<FormatCapability[]>([]);
  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([]);
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshot[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<DatabaseRestoreStatus | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<BackupSnapshot | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [startupData, setStartupData] = useState<StartupDataStatus | null>(null);
  const [libraryRemovalCandidate, setLibraryRemovalCandidate] = useState<Library | null>(null);
  const [libraryRemovalPreview, setLibraryRemovalPreview] = useState<LibraryRemovalPreview | null>(
    null,
  );
  const [deletedCleanupPreview, setDeletedCleanupPreview] =
    useState<DeletedBookCleanupPreview | null>(null);
  const [databaseResetStep, setDatabaseResetStep] = useState<"idle" | "confirm" | "scheduled">(
    "idle",
  );
  const [databaseResetSchedule, setDatabaseResetSchedule] = useState<DatabaseResetSchedule | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const loadedSections = useRef(new Set<SettingsSectionId>());
  const settingsRef = useRef<Record<string, unknown>>({});
  const saveGeneration = useRef(0);
  const saveStatusTimer = useRef<number | null>(null);
  const pushToast = useToastStore((state) => state.push);
  const locale = normalizeLocale(settings.locale);

  useEffect(() => {
    let disposed = false;
    void api
      .getSettings()
      .then((values) => {
        if (disposed) return;
        settingsRef.current = values;
        setSettings(values);
        setActiveSection(normalizeSettingsSection(values["ui.settings.section"]));
        syncApplicationSettings(values);
      })
      .catch((nextError) => !disposed && setError(formatUserError(nextError)));
    return () => {
      disposed = true;
      if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchText.trim());
      setSelectedResult(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (loadedSections.current.has(activeSection)) return;
    loadedSections.current.add(activeSection);
    let disposed = false;
    const load = async () => {
      try {
        if (activeSection === "library") {
          const nextLibraries = await api.listLibraries();
          if (!disposed) setLibraries(nextLibraries);
        }
        if (activeSection === "data") {
          const [nextHealth, snapshots, nextRestore, nextStartup] = await Promise.all([
            api.getDatabaseHealth(),
            api.listBackupSnapshots(),
            api.getDatabaseRestoreStatus(),
            api.getStartupDataStatus(),
          ]);
          if (!disposed) {
            setHealth(nextHealth);
            setBackupSnapshots(snapshots);
            setRestoreStatus(nextRestore);
            setStartupData(nextStartup);
          }
        }
        if (activeSection === "advanced") {
          const [capabilities, files] = await Promise.all([
            api.getFormatCapabilities(),
            api.listLogFiles(),
          ]);
          if (!disposed) {
            setFormatCapabilities(capabilities);
            setLogFiles(files);
          }
        }
        if (activeSection === "about") {
          const nextUpdate = await api.checkForUpdates();
          if (!disposed) setUpdate(nextUpdate);
        }
      } catch (nextError) {
        if (!disposed) setError(formatUserError(nextError));
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [activeSection]);

  const results = useMemo(() => searchSettings(debouncedSearch, locale), [debouncedSearch, locale]);
  const currentSection = settingsSections.find((entry) => entry.sectionId === activeSection)!;

  const markSaved = useCallback((status: SaveStatus) => {
    setSaveStatus(status);
    if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current);
    if (status === "saved") {
      saveStatusTimer.current = window.setTimeout(() => setSaveStatus("idle"), 1800);
    }
  }, []);

  const setSettingValue = useCallback(
    async (key: string, value: unknown) => {
      const generation = saveGeneration.current + 1;
      saveGeneration.current = generation;
      const optimisticSettings = { ...settingsRef.current, [key]: value };
      settingsRef.current = optimisticSettings;
      setSettings(optimisticSettings);
      syncApplicationSettings(optimisticSettings);
      markSaved("saving");
      try {
        const updated = await api.setSetting(key, value);
        if (generation !== saveGeneration.current) return true;
        settingsRef.current = updated;
        setSettings(updated);
        syncApplicationSettings(updated);
        markSaved("saved");
        return true;
      } catch (nextError) {
        if (generation === saveGeneration.current) {
          markSaved("error");
          pushToast({
            title: label("saveFailed", locale),
            description: formatUserError(nextError),
            tone: "error",
          });
        }
        return false;
      }
    },
    [locale, markSaved, pushToast],
  );

  const selectSection = useCallback(
    (sectionId: SettingsSectionId, persist = true) => {
      setActiveSection(sectionId);
      setSearchText("");
      setDebouncedSearch("");
      if (persist) void setSettingValue("ui.settings.section", sectionId);
    },
    [setSettingValue],
  );

  const openSearchResult = useCallback(
    (result: SettingsSearchResult) => {
      setActiveSection(result.sectionId);
      setSearchText("");
      setDebouncedSearch("");
      setHighlightTarget(result.focusTarget);
      void setSettingValue("ui.settings.section", result.sectionId);
      window.requestAnimationFrame(() => {
        const target = document.getElementById(result.focusTarget);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
        const focusable = target?.querySelector<HTMLElement>(
          "input, select, button, [tabindex]:not([tabindex='-1'])",
        );
        (focusable ?? target)?.focus({ preventScroll: true });
        target?.classList.add("ring-2", "ring-accent");
        window.setTimeout(() => {
          target?.classList.remove("ring-2", "ring-accent");
          setHighlightTarget(null);
        }, 1600);
      });
    },
    [setSettingValue],
  );

  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setSearchText("");
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedResult((value) => (value + 1) % results.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedResult((value) => (value - 1 + results.length) % results.length);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[selectedResult];
      if (result) openSearchResult(result);
    }
  };

  const restoreSectionDefaults = async () => {
    const entries = Object.entries(currentSection.restoreDefaults);
    if (entries.length === 0) return;
    if (
      !window.confirm(
        label("restoreSectionConfirm", locale).replace("{count}", String(entries.length)),
      )
    ) {
      return;
    }
    setBusy(true);
    markSaved("saving");
    let updated = settingsRef.current;
    try {
      for (const [key, value] of entries) updated = await api.setSetting(key, value);
      settingsRef.current = updated;
      setSettings(updated);
      syncApplicationSettings(updated);
      markSaved("saved");
    } catch (nextError) {
      settingsRef.current = updated;
      setSettings(updated);
      syncApplicationSettings(updated);
      markSaved("error");
      pushToast({
        title: label("restoreFailed", locale),
        description: formatUserError(nextError),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const resetAllSettings = async () => {
    if (!window.confirm(label("resetAllConfirm", locale))) return;
    setBusy(true);
    try {
      const updated = await api.resetApplicationSettings();
      settingsRef.current = updated;
      setSettings(updated);
      syncApplicationSettings(updated);
      setActiveSection("general");
      markSaved("saved");
    } catch (nextError) {
      pushToast({
        title: label("restoreFailed", locale),
        description: formatUserError(nextError),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const sectionContent = renderSection({
    activeSection,
    settings,
    locale,
    libraries,
    formatCapabilities,
    logFiles,
    health,
    backupSnapshots,
    restoreStatus,
    restoreCandidate,
    update,
    startupData,
    libraryRemovalCandidate,
    libraryRemovalPreview,
    deletedCleanupPreview,
    databaseResetStep,
    databaseResetSchedule,
    busy,
    setSettingValue,
    setLibraries,
    setFormatCapabilities,
    setLogFiles,
    setBackupSnapshots,
    setRestoreStatus,
    setRestoreCandidate,
    setLibraryRemovalCandidate,
    setLibraryRemovalPreview,
    setDeletedCleanupPreview,
    setDatabaseResetStep,
    setDatabaseResetSchedule,
    setBusy,
    pushToast,
    resetAllSettings,
  });

  return (
    <section
      className="flex h-full min-w-0 flex-1 flex-col bg-background"
      data-testid="settings-center"
    >
      <header className="border-b border-border bg-panel px-5 py-4">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{label("settings", locale)}</h1>
            <p className="mt-0.5 text-xs text-foreground/55">{label("settingsSubtitle", locale)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div aria-live="polite" className="min-w-20 text-right text-xs text-foreground/55">
              {saveStatus === "saving" && label("saving", locale)}
              {saveStatus === "saved" && (
                <span className="inline-flex items-center gap-1 text-emerald-500">
                  <Check size={14} /> {label("saved", locale)}
                </span>
              )}
              {saveStatus === "error" && (
                <span className="text-danger">{label("saveFailed", locale)}</span>
              )}
            </div>
            <div className="relative w-[min(360px,38vw)] min-w-[220px]">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/45"
              />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={label("searchPlaceholder", locale)}
                aria-label={label("searchPlaceholder", locale)}
                aria-controls="settings-search-results"
                aria-expanded={Boolean(debouncedSearch)}
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm"
              />
              {debouncedSearch && (
                <div
                  id="settings-search-results"
                  role="listbox"
                  className="absolute right-0 top-11 z-30 max-h-[420px] w-[min(460px,70vw)] overflow-auto rounded-md border border-border bg-panel p-1 shadow-2xl"
                >
                  <div className="sr-only" aria-live="polite">
                    {label("resultCount", locale).replace("{count}", String(results.length))}
                  </div>
                  {results.map((result, index) => (
                    <button
                      key={result.settingId}
                      type="button"
                      role="option"
                      aria-selected={index === selectedResult}
                      onMouseEnter={() => setSelectedResult(index)}
                      onClick={() => openSearchResult(result)}
                      className={cn(
                        "w-full rounded px-3 py-2 text-left",
                        index === selectedResult ? "bg-panelMuted" : "hover:bg-panelMuted",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3 text-sm font-medium">
                        <span>{result.title}</span>
                        <span className="text-xs text-foreground/45">{result.sectionTitle}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-foreground/55">
                        {result.description}
                      </div>
                    </button>
                  ))}
                  {results.length === 0 && (
                    <div className="px-3 py-5 text-center text-sm text-foreground/55">
                      {label("noResults", locale)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      {error && (
        <div role="alert" className="border-b border-danger/40 bg-danger/10 px-5 py-2 text-sm">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-5">
        <div className="mx-auto flex h-full max-w-[1080px] gap-5">
          <nav
            className="thin-scrollbar hidden w-[216px] shrink-0 overflow-y-auto lg:block"
            aria-label={label("categories", locale)}
          >
            <div className="space-y-1">
              {settingsSections.map((section) => (
                <SettingsNavButton
                  key={section.sectionId}
                  section={section}
                  locale={locale}
                  active={activeSection === section.sectionId}
                  onClick={() => selectSection(section.sectionId)}
                />
              ))}
            </div>
          </nav>
          <main
            className="thin-scrollbar min-w-0 flex-1 overflow-y-auto pr-1"
            data-testid="settings-section-content"
          >
            <label className="mb-4 block lg:hidden">
              <span className="sr-only">{label("categories", locale)}</span>
              <select
                value={activeSection}
                onChange={(event) => selectSection(event.target.value as SettingsSectionId)}
                className="h-10 w-full rounded-md border border-border bg-panel px-3 text-sm"
              >
                {settingsSections.map((section) => (
                  <option key={section.sectionId} value={section.sectionId}>
                    {localizeSettingsText(section.title, locale)}
                  </option>
                ))}
              </select>
            </label>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">
                  {localizeSettingsText(currentSection.title, locale)}
                </h2>
                <p className="mt-1 max-w-[720px] text-sm text-foreground/55">
                  {localizeSettingsText(currentSection.description, locale)}
                </p>
              </div>
              {Object.keys(currentSection.restoreDefaults).length > 0 && (
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => void restoreSectionDefaults()}
                >
                  <RefreshCw size={15} />
                  {label("restoreSection", locale)}
                </Button>
              )}
            </div>
            <div
              data-settings-section={activeSection}
              className={cn("pb-8", highlightTarget && "[&_.setting-highlight]:ring-0")}
            >
              {sectionContent}
            </div>
          </main>
        </div>
      </div>
    </section>
  );
}

interface SectionContext {
  activeSection: SettingsSectionId;
  settings: Record<string, unknown>;
  locale: Locale;
  libraries: Library[];
  formatCapabilities: FormatCapability[];
  logFiles: LogFileInfo[];
  health: DatabaseHealth | null;
  backupSnapshots: BackupSnapshot[];
  restoreStatus: DatabaseRestoreStatus | null;
  restoreCandidate: BackupSnapshot | null;
  update: UpdateStatus | null;
  startupData: StartupDataStatus | null;
  libraryRemovalCandidate: Library | null;
  libraryRemovalPreview: LibraryRemovalPreview | null;
  deletedCleanupPreview: DeletedBookCleanupPreview | null;
  databaseResetStep: "idle" | "confirm" | "scheduled";
  databaseResetSchedule: DatabaseResetSchedule | null;
  busy: boolean;
  setSettingValue: (key: string, value: unknown) => Promise<boolean>;
  setLibraries: (value: Library[]) => void;
  setFormatCapabilities: (value: FormatCapability[]) => void;
  setLogFiles: (value: LogFileInfo[]) => void;
  setBackupSnapshots: (value: BackupSnapshot[]) => void;
  setRestoreStatus: (value: DatabaseRestoreStatus | null) => void;
  setRestoreCandidate: (value: BackupSnapshot | null) => void;
  setLibraryRemovalCandidate: (value: Library | null) => void;
  setLibraryRemovalPreview: (value: LibraryRemovalPreview | null) => void;
  setDeletedCleanupPreview: (value: DeletedBookCleanupPreview | null) => void;
  setDatabaseResetStep: (value: "idle" | "confirm" | "scheduled") => void;
  setDatabaseResetSchedule: (value: DatabaseResetSchedule | null) => void;
  setBusy: (value: boolean) => void;
  pushToast: ReturnType<typeof useToastStore.getState>["push"];
  resetAllSettings: () => Promise<void>;
}

function renderSection(context: SectionContext): ReactNode {
  switch (context.activeSection) {
    case "general":
      return <GeneralSettings {...context} />;
    case "library":
      return <LibrarySettings {...context} />;
    case "reader":
      return <ReaderSettingsSection {...context} />;
    case "display":
      return <DisplaySettings {...context} />;
    case "input":
      return <InputSettings {...context} />;
    case "storage":
      return <StorageSettings {...context} />;
    case "data":
      return <DataSettings {...context} />;
    case "advanced":
      return <AdvancedSettings {...context} />;
    case "about":
      return <AboutSettings {...context} />;
  }
}

function GeneralSettings({ settings, locale, setSettingValue, resetAllSettings }: SectionContext) {
  const layout = normalizeLayoutSettings(settings);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsGroup title={label("appearance", locale)}>
        <SettingTarget id="appearance-theme">
          <div className="flex flex-wrap gap-2">
            {(["system", "dark", "light"] as ThemePreference[]).map((theme) => {
              const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
              return (
                <Button
                  key={theme}
                  variant={
                    normalizeTheme(settings["appearance.theme"]) === theme ? "primary" : "subtle"
                  }
                  onClick={() => void setSettingValue("appearance.theme", theme)}
                >
                  <Icon size={16} /> {label(theme, locale)}
                </Button>
              );
            })}
          </div>
        </SettingTarget>
        <SettingSelect
          id="locale"
          icon={Languages}
          label={label("language", locale)}
          value={normalizeLocale(settings.locale)}
          options={[
            ["zh-CN", "简体中文"],
            ["en-US", "English"],
          ]}
          onChange={(value) => void setSettingValue("locale", value)}
        />
      </SettingsGroup>
      <SettingsGroup title={label("interface", locale)}>
        <SettingSelect
          id="ui-layout-sidebar_mode"
          icon={PanelLeft}
          label={label("sidebar", locale)}
          value={layout.sidebarMode}
          options={[
            ["expanded", label("expanded", locale)],
            ["compact", label("compact", locale)],
          ]}
          onChange={(value) => void setSettingValue("ui.layout.sidebar_mode", value)}
        />
        <SettingToggle
          id="ui-command_palette-enabled"
          label={label("quickActions", locale)}
          description={label("quickActionsDescription", locale)}
          enabled={layout.commandPaletteEnabled}
          onToggle={() =>
            void setSettingValue("ui.command_palette.enabled", !layout.commandPaletteEnabled)
          }
        />
      </SettingsGroup>
      <div className="xl:col-span-2">
        <SettingsGroup title={label("resetPreferences", locale)}>
          <p className="text-sm text-foreground/55">
            {label("resetPreferencesDescription", locale)}
          </p>
          <Button className="mt-3" variant="subtle" onClick={() => void resetAllSettings()}>
            <RefreshCw size={16} /> {label("resetAll", locale)}
          </Button>
        </SettingsGroup>
      </div>
    </div>
  );
}

function LibrarySettings(context: SectionContext) {
  const { settings, locale, libraries, setSettingValue, pushToast } = context;
  const layout = normalizeLayoutSettings(settings);
  const addLibrary = async () => {
    try {
      const root = await api.chooseImportFolder();
      if (!root) return;
      await api.importFolder(root, true);
      context.setLibraries(await api.listLibraries());
      pushToast({
        title: label("libraryAdded", locale),
        description: displayPath(root),
        tone: "success",
      });
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };
  const rescan = async (library: Library) => {
    try {
      await api.rescanLibrary(library.rootPath, library.recursive);
      pushToast({
        title: label("scanStarted", locale),
        description: displayPath(library.rootPath),
        tone: "info",
      });
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };
  const requestRemoval = async (library: Library) => {
    try {
      context.setLibraryRemovalCandidate(library);
      context.setLibraryRemovalPreview(await api.getLibraryRemovalPreview(library.id));
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };
  const removeLibrary = async () => {
    if (!context.libraryRemovalCandidate) return;
    try {
      await api.removeLibrary(context.libraryRemovalCandidate.id);
      context.setLibraries(await api.listLibraries());
      context.setLibraryRemovalCandidate(null);
      context.setLibraryRemovalPreview(null);
      pushToast({ title: label("libraryRemoved", locale), tone: "success" });
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsGroup title={label("browseAndOpen", locale)}>
          <SettingSelect
            id="ui-layout-grid_density"
            icon={LayoutGrid}
            label={label("gridDensity", locale)}
            value={layout.gridDensity}
            options={[
              ["comfortable", label("comfortable", locale)],
              ["compact", label("compact", locale)],
              ["spacious", label("spacious", locale)],
            ]}
            onChange={(value) => void setSettingValue("ui.layout.grid_density", value)}
          />
          <SettingSelect
            id="ui-layout-cover_aspect_ratio"
            icon={LayoutGrid}
            label={label("coverRatio", locale)}
            value={layout.coverAspectRatio}
            options={[
              ["portrait", label("portrait", locale)],
              ["square", label("square", locale)],
              ["tall", label("tall", locale)],
            ]}
            onChange={(value) => void setSettingValue("ui.layout.cover_aspect_ratio", value)}
          />
          <SettingSelect
            id="library-open_mouse_action"
            icon={MousePointerClick}
            label={label("openMouseAction", locale)}
            value={normalizeBookOpenMouseAction(settings[BOOK_OPEN_MOUSE_ACTION_KEY])}
            options={[
              ["double", label("doubleClickOpen", locale)],
              ["single", label("singleClickOpen", locale)],
            ]}
            onChange={(value) => void setSettingValue(BOOK_OPEN_MOUSE_ACTION_KEY, value)}
          />
        </SettingsGroup>
        <SettingsGroup title={label("scanDefaults", locale)}>
          <SettingToggle
            id="scanner-recursive"
            label={label("recursiveScan", locale)}
            description={label("recursiveScanDescription", locale)}
            enabled={settings["scanner.recursive"] !== false}
            onToggle={() =>
              void setSettingValue("scanner.recursive", settings["scanner.recursive"] === false)
            }
          />
        </SettingsGroup>
      </div>
      <SettingsGroup title={label("foldersAndScanning", locale)}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-foreground/55">{label("multipleFolders", locale)}</p>
          <Button size="sm" onClick={() => void addLibrary()}>
            <Plus size={15} /> {label("addFolder", locale)}
          </Button>
        </div>
        <div className="space-y-2" id="setting-library-folders" tabIndex={-1}>
          {libraries.map((library) => (
            <div
              key={library.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-3 first:border-t-0"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{library.name}</div>
                <div
                  className="mt-1 truncate text-xs text-foreground/50"
                  title={displayPath(library.rootPath)}
                >
                  {displayPath(library.rootPath)}
                </div>
                <div className="mt-1 text-xs text-foreground/45">
                  {library.bookCount} {label("books", locale)} ·{" "}
                  {library.lastScanAt
                    ? formatDateTime(library.lastScanAt)
                    : label("notScanned", locale)}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="subtle"
                  title={label("openFolder", locale)}
                  onClick={() => void api.openPathInShell(library.rootPath)}
                >
                  <FolderOpen size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="subtle"
                  title={label("rescan", locale)}
                  onClick={() => void rescan(library)}
                >
                  <RefreshCw size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="subtle"
                  title={label("remove", locale)}
                  onClick={() => void requestRemoval(library)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          ))}
          {libraries.length === 0 && (
            <div className="py-5 text-center text-sm text-foreground/55">
              {label("noLibraries", locale)}
            </div>
          )}
        </div>
        {context.libraryRemovalCandidate && context.libraryRemovalPreview && (
          <div className="mt-3 border border-danger/40 bg-danger/10 p-3 text-sm">
            <div className="font-medium">{label("removeLibraryConfirm", locale)}</div>
            <p className="mt-1 text-xs text-foreground/65">
              {label("removeLibraryScope", locale)
                .replace("{books}", String(context.libraryRemovalPreview.books))
                .replace("{bookmarks}", String(context.libraryRemovalPreview.bookmarks))}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="danger" onClick={() => void removeLibrary()}>
                {label("removeFromApp", locale)}
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => {
                  context.setLibraryRemovalCandidate(null);
                  context.setLibraryRemovalPreview(null);
                }}
              >
                {label("cancel", locale)}
              </Button>
            </div>
          </div>
        )}
      </SettingsGroup>
      <JmComicSourcePanel
        locale={locale}
        pushToast={pushToast}
        settings={settings}
        setSettingValue={setSettingValue}
      />
      <details className="border-t border-border pt-3" id="setting-library-formats">
        <summary className="cursor-pointer text-sm font-medium">
          {label("formatDetails", locale)}
        </summary>
        <p className="mt-2 text-xs text-foreground/55">{label("formatDetailsAdvanced", locale)}</p>
      </details>
    </div>
  );
}

function JmComicSourcePanel({
  locale,
  pushToast,
  settings,
  setSettingValue,
}: {
  locale: Locale;
  pushToast: ReturnType<typeof useToastStore.getState>["push"];
  settings: Record<string, unknown>;
  setSettingValue: (key: string, value: unknown) => Promise<boolean>;
}) {
  const [sources, setSources] = useState<JmComicSourceCandidate[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [preview, setPreview] = useState<JmComicMatchPreview | null>(null);
  const [importResult, setImportResult] = useState<ExternalIdentityImportResult | null>(null);
  const [providerStatus, setProviderStatus] = useState<JmComicProviderStatus | null>(null);
  const [batchPreview, setBatchPreview] = useState<MetadataBatchPreview | null>(null);
  const [batchResult, setBatchResult] = useState<MetadataBatchResult | null>(null);
  const [busyAction, setBusyAction] = useState<
    "discover" | "preview" | "import" | "batch-preview" | "batch-run" | null
  >(null);

  const refreshProviderStatus = useCallback(() => {
    void api
      .getJmComicProviderStatus()
      .then(setProviderStatus)
      .catch(() => undefined);
  }, []);

  useEffect(refreshProviderStatus, [refreshProviderStatus]);

  const discover = async () => {
    setBusyAction("discover");
    setPreview(null);
    try {
      const found = await api.discoverJmComicSources();
      setSources(found);
      const preferred = found.find((source) => source.healthy && source.downloadCount > 0);
      if (preferred) setSelectedPath(preferred.databasePath);
      if (found.length === 0) {
        pushToast({ title: label("jmComicNotFound", locale), tone: "info" });
      }
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const chooseDatabase = async () => {
    try {
      const path = await api.chooseJmComicDatabase();
      if (!path) return;
      setSelectedPath(path);
      setPreview(null);
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };

  const buildPreview = async () => {
    if (!selectedPath) return;
    setBusyAction("preview");
    try {
      setPreview(await api.previewJmComicMatches(selectedPath));
      setImportResult(null);
    } catch (error) {
      pushToast({
        title: label("jmComicPreviewFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const importIdentities = async () => {
    if (!selectedPath || !preview) return;
    setBusyAction("import");
    try {
      const result = await api.importJmComicIdentities(selectedPath, preview.previewToken);
      setImportResult(result);
      refreshProviderStatus();
      pushToast({
        title: label("jmIdsImported", locale),
        description: label("jmIdsImportedDetail", locale)
          .replace("{linked}", String(result.linked))
          .replace("{unchanged}", String(result.unchanged))
          .replace("{conflicts}", String(result.conflicts)),
        tone: result.conflicts > 0 ? "info" : "success",
      });
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const onlineEnabled = settings["metadata.jmcomic.enabled"] === true;
  const endpoint = String(settings["metadata.jmcomic.endpoint"] ?? "https://www.cdngwc.cc");

  const previewBatch = async () => {
    setBusyAction("batch-preview");
    setBatchResult(null);
    try {
      setBatchPreview(await api.previewJmComicMetadataBatch(false));
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runBatch = async () => {
    if (!batchPreview) return;
    setBusyAction("batch-run");
    try {
      const result = await api.runJmComicMetadataBatch(batchPreview.previewToken, false);
      setBatchResult(result);
      setBatchPreview(null);
      refreshProviderStatus();
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <SettingsGroup id="setting-library-jmcomic" title={label("jmComicSource", locale)}>
      <p className="text-sm text-foreground/60">{label("jmComicSourceDescription", locale)}</p>
      <div className="border border-border bg-background p-3">
        <SettingToggle
          id="metadata-jmcomic-enabled"
          label={label("jmOnlineMetadata", locale)}
          description={label("jmOnlineMetadataDescription", locale)}
          enabled={onlineEnabled}
          onToggle={() =>
            void setSettingValue("metadata.jmcomic.enabled", !onlineEnabled).then(
              refreshProviderStatus,
            )
          }
        />
        {onlineEnabled && (
          <div className="grid gap-3 pt-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-foreground/60">
              {label("metadataEndpoint", locale)}
              <select
                value={endpoint}
                onChange={(event) =>
                  void setSettingValue("metadata.jmcomic.endpoint", event.target.value)
                }
                className="h-9 rounded-md border border-border bg-panel px-2 text-sm text-foreground"
              >
                <option value="https://www.cdngwc.cc">www.cdngwc.cc</option>
                <option value="https://www.cdnhjk.net">www.cdnhjk.net</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-foreground/60">
              {label("metadataRefresh", locale)}
              <select
                value={String(settings["metadata.jmcomic.refresh_days"] ?? 30)}
                onChange={(event) =>
                  void setSettingValue("metadata.jmcomic.refresh_days", Number(event.target.value))
                }
                className="h-9 rounded-md border border-border bg-panel px-2 text-sm text-foreground"
              >
                <option value="7">7 {label("days", locale)}</option>
                <option value="30">30 {label("days", locale)}</option>
                <option value="90">90 {label("days", locale)}</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-foreground/60">
              {label("autoMetadataAfterImport", locale)}
              <select
                value={String(settings["metadata.jmcomic.auto_enrich"] ?? "off")}
                onChange={(event) =>
                  void setSettingValue("metadata.jmcomic.auto_enrich", event.target.value)
                }
                className="h-9 rounded-md border border-border bg-panel px-2 text-sm text-foreground"
              >
                <option value="off">{label("manualOnly", locale)}</option>
                <option value="after_import">{label("afterImport", locale)}</option>
              </select>
            </label>
          </div>
        )}
        {providerStatus && (
          <p className="pt-2 text-xs text-foreground/50">
            {label("jmProviderStatus", locale)
              .replace("{linked}", String(providerStatus.linkedBooks))
              .replace("{cached}", String(providerStatus.cachedBooks))}
          </p>
        )}
        {onlineEnabled && providerStatus && providerStatus.linkedBooks > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              size="sm"
              variant="subtle"
              disabled={busyAction !== null}
              onClick={() => void previewBatch()}
            >
              <RefreshCw size={15} /> {label("previewMetadataBatch", locale)}
            </Button>
            {busyAction === "batch-run" && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => void api.cancelJmComicMetadataBatch()}
              >
                {label("cancelBatch", locale)}
              </Button>
            )}
          </div>
        )}
        {batchPreview && (
          <div className="mt-3 border border-border bg-panel p-3 text-xs">
            <p>
              {label("metadataBatchPreview", locale)
                .replace("{eligible}", String(batchPreview.eligible))
                .replace("{fresh}", String(batchPreview.freshCached))}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={busyAction !== null || batchPreview.eligible === 0}
                onClick={() => void runBatch()}
              >
                {label("confirmMetadataBatch", locale)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBatchPreview(null)}>
                {label("cancel", locale)}
              </Button>
            </div>
          </div>
        )}
        {batchResult && (
          <p className="mt-2 text-xs text-foreground/60" role="status">
            {label("metadataBatchResult", locale)
              .replace("{success}", String(batchResult.succeeded))
              .replace("{failed}", String(batchResult.failed))}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="subtle" disabled={busyAction !== null} onClick={discover}>
          <FileSearch size={15} />
          {busyAction === "discover"
            ? label("discovering", locale)
            : label("discoverSource", locale)}
        </Button>
        <Button size="sm" variant="subtle" disabled={busyAction !== null} onClick={chooseDatabase}>
          <FolderOpen size={15} /> {label("chooseDatabase", locale)}
        </Button>
        <Button size="sm" disabled={!selectedPath || busyAction !== null} onClick={buildPreview}>
          <Link2 size={15} />
          {busyAction === "preview" ? label("matching", locale) : label("previewMatches", locale)}
        </Button>
      </div>
      {selectedPath && (
        <div
          className="truncate border-l-2 border-accent pl-3 text-xs text-foreground/55"
          title={displayPath(selectedPath)}
        >
          {displayPath(selectedPath)}
        </div>
      )}
      {sources.length > 0 && (
        <div className="space-y-2" aria-label={label("discoveredSources", locale)}>
          {sources.map((source) => (
            <button
              key={source.databasePath}
              type="button"
              onClick={() => {
                setSelectedPath(source.databasePath);
                setPreview(null);
              }}
              className={cn(
                "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border p-3 text-left",
                selectedPath === source.databasePath
                  ? "border-accent bg-accent/10"
                  : "border-border bg-background hover:bg-panelMuted",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {displayPath(source.dataDirectory)}
                </span>
                <span className="mt-1 block truncate text-xs text-foreground/50">
                  {displayPath(source.databasePath)}
                </span>
              </span>
              <span className="text-right text-xs text-foreground/60">
                <span className="block">
                  {source.downloadCount} {label("downloadRecords", locale)}
                </span>
                <span className={source.healthy ? "text-success" : "text-danger"}>
                  {source.healthy ? label("sourceHealthy", locale) : label("sourceInvalid", locale)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {preview && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <strong>{label("readOnlyPreview", locale)}</strong>
            <span>
              {label("sourceRecords", locale)}: {preview.sourceRecords}
            </span>
            <span className="text-success">
              {label("matched", locale)}: {preview.matched}
            </span>
            <span>
              {label("unmatched", locale)}: {preview.unmatched}
            </span>
            <span>
              {label("missingSource", locale)}: {preview.missingSource}
            </span>
            <span>
              {label("ambiguous", locale)}: {preview.ambiguous}
            </span>
          </div>
          <p className="text-xs text-foreground/55">{label("previewDoesNotWrite", locale)}</p>
          {preview.matched > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                disabled={busyAction !== null}
                onClick={() => void importIdentities()}
              >
                <Link2 size={15} />
                {busyAction === "import"
                  ? label("importingJmIds", locale)
                  : label("importJmIds", locale).replace("{count}", String(preview.matched))}
              </Button>
              <span className="text-xs text-foreground/50">
                {label("importJmIdsScope", locale)}
              </span>
            </div>
          )}
          {importResult && (
            <p className="text-xs text-success" role="status">
              {label("jmIdsImportedDetail", locale)
                .replace("{linked}", String(importResult.linked))
                .replace("{unchanged}", String(importResult.unchanged))
                .replace("{conflicts}", String(importResult.conflicts))}
            </p>
          )}
          <div className="max-h-80 overflow-auto border border-border">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 bg-panelMuted text-foreground/60">
                <tr>
                  <th className="w-24 px-3 py-2">JM ID</th>
                  <th className="px-3 py-2">{label("sourceWork", locale)}</th>
                  <th className="w-28 px-3 py-2">{label("matchStatus", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.slice(0, 100).map((item) => (
                  <tr key={item.jmId} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{item.jmId}</td>
                    <td className="px-3 py-2">
                      <div className="truncate" title={item.sourceTitle}>
                        {item.sourceTitle}
                      </div>
                      <div
                        className="mt-1 truncate text-foreground/45"
                        title={displayPath(item.logicalRootPath)}
                      >
                        {displayPath(item.logicalRootPath)}
                      </div>
                    </td>
                    <td className="px-3 py-2">{label(`jmStatus_${item.status}`, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.items.length > 100 && (
            <p className="text-xs text-foreground/50">
              {label("previewFirstHundred", locale).replace(
                "{count}",
                String(preview.items.length),
              )}
            </p>
          )}
        </div>
      )}
    </SettingsGroup>
  );
}

function ReaderSettingsSection({ settings, locale, setSettingValue }: SectionContext) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsGroup title={label("defaultReading", locale)}>
        <SettingSelect
          id="reader-mode"
          icon={PanelRight}
          label={label("readingMode", locale)}
          value={String(settings["reader.mode"] ?? "single")}
          options={[
            ["single", label("singlePage", locale)],
            ["double", label("doublePage", locale)],
            ["scroll", label("continuousScroll", locale)],
          ]}
          onChange={(value) => void setSettingValue("reader.mode", value)}
        />
        <SettingSelect
          id="reader-direction"
          icon={BookOpen}
          label={label("direction", locale)}
          value={String(settings["reader.direction"] ?? "ltr")}
          options={[
            ["ltr", label("ltr", locale)],
            ["rtl", label("rtl", locale)],
          ]}
          onChange={(value) => void setSettingValue("reader.direction", value)}
        />
        <SettingSelect
          id="reader-fit"
          icon={LayoutGrid}
          label={label("fitMode", locale)}
          value={String(settings["reader.fit"] ?? "width")}
          options={[
            ["width", label("fitWidth", locale)],
            ["height", label("fitHeight", locale)],
            ["original", label("originalSize", locale)],
          ]}
          onChange={(value) => void setSettingValue("reader.fit", value)}
        />
        <SettingSelect
          id="reader-launch_state"
          icon={Monitor}
          label={label("openState", locale)}
          value={normalizeReaderLaunchPreference(settings[READER_LAUNCH_STATE_KEY])}
          options={[
            ["windowed", label("windowed", locale)],
            ["focus", label("focusReading", locale)],
            ["remember", label("rememberLast", locale)],
          ]}
          onChange={(value) => void setSettingValue(READER_LAUNCH_STATE_KEY, value)}
        />
      </SettingsGroup>
      <SettingsGroup title={label("readerInterface", locale)}>
        <SettingSelect
          id="reader-controls_layout"
          icon={PanelRight}
          label={label("controlsLayout", locale)}
          value={String(settings["reader.controls_layout"] ?? "auto")}
          options={[
            ["auto", label("automatic", locale)],
            ["overlay", label("overlay", locale)],
            ["reserved", label("reserved", locale)],
          ]}
          onChange={(value) => void setSettingValue("reader.controls_layout", value)}
        />
        <p className="text-sm leading-6 text-foreground/55">
          {label("focusReadingDescription", locale)}
        </p>
      </SettingsGroup>
    </div>
  );
}

function DisplaySettings({ settings, locale, setSettingValue }: SectionContext) {
  const update = async (key: string, value: unknown) => {
    if (await setSettingValue(key, value)) {
      const storeKey = key.replace("reader.", "");
      if (storeKey in useReaderStore.getState().settings) {
        useReaderStore.setState((state) => ({
          settings: { ...state.settings, [storeKey]: value },
        }));
      }
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsGroup title={label("imageDefaults", locale)}>
        <RangeSetting
          id="reader-brightness"
          label={label("brightness", locale)}
          value={numberSetting(settings["reader.brightness"], 100)}
          min={50}
          max={150}
          onChange={(value) => void update("reader.brightness", value)}
        />
        <RangeSetting
          id="reader-contrast"
          label={label("contrast", locale)}
          value={numberSetting(settings["reader.contrast"], 100)}
          min={50}
          max={150}
          onChange={(value) => void update("reader.contrast", value)}
        />
        <RangeSetting
          id="reader-saturation"
          label={label("saturation", locale)}
          value={numberSetting(settings["reader.saturation"], 100)}
          min={0}
          max={200}
          onChange={(value) => void update("reader.saturation", value)}
        />
        <SettingToggle
          id="reader-grayscale"
          label={label("grayscale", locale)}
          description={label("grayscaleDescription", locale)}
          enabled={settings["reader.grayscale"] === true}
          onToggle={() => void update("reader.grayscale", settings["reader.grayscale"] !== true)}
        />
        <SettingToggle
          id="reader-sharpen"
          label={label("sharpen", locale)}
          description={label("sharpenDescription", locale)}
          enabled={settings["reader.sharpen"] === true}
          onToggle={() => void update("reader.sharpen", settings["reader.sharpen"] !== true)}
        />
        <SettingToggle
          id="reader-trim_white"
          label={label("trimWhite", locale)}
          description={label("trimWhiteDescription", locale)}
          enabled={settings["reader.trim_white"] === true}
          onToggle={() => void update("reader.trim_white", settings["reader.trim_white"] !== true)}
        />
      </SettingsGroup>
      <SettingsGroup title={label("readingBackground", locale)}>
        <label
          id="setting-reader-background"
          tabIndex={-1}
          className="flex items-center justify-between gap-3 border-b border-border py-3"
        >
          <span className="text-sm font-medium">{label("backgroundColor", locale)}</span>
          <input
            type="color"
            value={String(settings["reader.background"] ?? "#0b0f14")}
            onChange={(event) => void update("reader.background", event.target.value)}
            className="h-9 w-14 rounded border border-border bg-background p-1"
          />
        </label>
        {settings["reader.night"] === true && (
          <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="font-medium">{label("legacyEffect", locale)}</div>
            <p className="mt-1 text-xs text-foreground/60">
              {label("legacyEffectDescription", locale)}
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="subtle"
              onClick={() => void update("reader.night", false)}
            >
              {label("disableInvert", locale)}
            </Button>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

function InputSettings({ settings, setSettingValue }: SectionContext) {
  return (
    <div>
      <div id="setting-shortcuts" tabIndex={-1}>
        <ShortcutSettingsPanel settings={settings} onPersist={setSettingValue} />
      </div>
    </div>
  );
}

function StorageSettings(context: SectionContext) {
  const { settings, locale, setSettingValue, pushToast, busy, setBusy } = context;
  const run = async (task: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      pushToast({ title: success, tone: "success" });
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsGroup title={label("memoryAndCache", locale)}>
          <SettingToggle
            id="performance-low_memory"
            label={label("lowMemory", locale)}
            description={label("lowMemoryDescription", locale)}
            enabled={settings["performance.low_memory"] === true}
            onToggle={() =>
              void setSettingValue(
                "performance.low_memory",
                settings["performance.low_memory"] !== true,
              )
            }
          />
          <NumberSetting
            id="cache-thumbnail_limit_mb"
            label={label("thumbnailLimit", locale)}
            value={numberSetting(settings["cache.thumbnail_limit_mb"], 2048)}
            min={128}
            max={16384}
            onCommit={(value) => void setSettingValue("cache.thumbnail_limit_mb", value)}
          />
          <p className="text-xs leading-5 text-foreground/55">{label("cacheSafety", locale)}</p>
          <div id="setting-storage-clear_cache" tabIndex={-1}>
            <Button
              disabled={busy}
              variant="subtle"
              onClick={() => void run(api.clearApplicationCaches, label("cacheCleared", locale))}
            >
              <Trash2 size={16} /> {label("clearCache", locale)}
            </Button>
          </div>
        </SettingsGroup>
        <SettingsGroup id="setting-storage-optimize" title={label("databaseMaintenance", locale)}>
          <p className="text-sm text-foreground/55">
            {label("databaseMaintenanceDescription", locale)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(() => api.optimizeDatabase(false), label("optimized", locale))
              }
            >
              <Gauge size={16} /> ANALYZE
            </Button>
            <Button
              disabled={busy}
              variant="subtle"
              onClick={() => void run(() => api.optimizeDatabase(true), label("optimized", locale))}
            >
              <Database size={16} /> VACUUM
            </Button>
          </div>
        </SettingsGroup>
      </div>
      <SettingsGroup id="setting-storage-cleanup" title={label("staleData", locale)}>
        <Button
          variant="subtle"
          onClick={() =>
            void api.getDeletedBookCleanupPreview().then(context.setDeletedCleanupPreview)
          }
        >
          <Trash2 size={16} /> {label("previewCleanup", locale)}
        </Button>
        {context.deletedCleanupPreview && (
          <div className="mt-3 text-sm text-foreground/60">
            {label("cleanupSummary", locale)
              .replace("{books}", String(context.deletedCleanupPreview.books))
              .replace("{size}", formatBytes(context.deletedCleanupPreview.thumbnailBytes))}
            {context.deletedCleanupPreview.books > 0 && (
              <Button
                className="ml-3"
                size="sm"
                variant="danger"
                onClick={() => void run(api.purgeDeletedBooks, label("cleanupComplete", locale))}
              >
                {label("confirmCleanup", locale)}
              </Button>
            )}
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

function DataSettings(context: SectionContext) {
  const {
    locale,
    health,
    backupSnapshots,
    restoreStatus,
    restoreCandidate,
    startupData,
    pushToast,
    busy,
    setBusy,
  } = context;
  const backup = async () => {
    setBusy(true);
    try {
      const path = await api.backupDatabase();
      context.setBackupSnapshots(await api.listBackupSnapshots());
      pushToast({
        title: label("backupCreated", locale),
        description: displayPath(path),
        tone: "success",
      });
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  const scheduleRestore = async () => {
    if (!restoreCandidate) return;
    try {
      context.setRestoreStatus(await api.scheduleDatabaseRestore(restoreCandidate.snapshotPath));
      context.setRestoreCandidate(null);
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    }
  };
  const scheduleReset = async () => {
    setBusy(true);
    try {
      const schedule = await api.scheduleDatabaseReset();
      context.setDatabaseResetSchedule(schedule);
      context.setDatabaseResetStep("scheduled");
      context.setBackupSnapshots(await api.listBackupSnapshots());
    } catch (error) {
      pushToast({
        title: label("actionFailed", locale),
        description: formatUserError(error),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsGroup id="setting-data-health" title={label("healthAndLocation", locale)}>
          <InfoRow
            label={label("databaseHealth", locale)}
            value={
              health
                ? health.ok
                  ? label("healthy", locale)
                  : health.message
                : label("checking", locale)
            }
          />
          {startupData?.appDataPath && (
            <div id="setting-data-location" tabIndex={-1}>
              <InfoRow
                label={label("dataLocation", locale)}
                value={displayPath(startupData.appDataPath)}
              />
              <Button
                className="mt-2"
                size="sm"
                variant="subtle"
                onClick={() => void api.openPathInShell(startupData.appDataPath)}
              >
                <FolderOpen size={15} /> {label("openFolder", locale)}
              </Button>
            </div>
          )}
        </SettingsGroup>
        <SettingsGroup id="setting-data-backup" title={label("backup", locale)}>
          <Button disabled={busy} onClick={() => void backup()}>
            <Database size={16} /> {label("backupNow", locale)}
          </Button>
          <p className="mt-2 text-xs text-foreground/55">{label("backupDescription", locale)}</p>
        </SettingsGroup>
      </div>
      <SettingsGroup title={label("restore", locale)}>
        {restoreStatus?.pendingSnapshot ? (
          <div className="border border-accent/40 bg-accent/10 p-3 text-sm">
            {label("restorePending", locale)}
            <Button
              className="ml-3"
              size="sm"
              variant="subtle"
              onClick={() => void api.cancelDatabaseRestore().then(context.setRestoreStatus)}
            >
              {label("cancel", locale)}
            </Button>
          </div>
        ) : restoreCandidate ? (
          <div className="border border-danger/40 bg-danger/10 p-3 text-sm">
            <div className="font-medium">{label("restoreConfirm", locale)}</div>
            <div className="mt-1 break-all text-xs">
              {displayPath(restoreCandidate.snapshotPath)}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="danger" onClick={() => void scheduleRestore()}>
                {label("restoreOnRestart", locale)}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => context.setRestoreCandidate(null)}>
                {label("cancel", locale)}
              </Button>
            </div>
          </div>
        ) : backupSnapshots.length > 0 ? (
          <div className="divide-y divide-border">
            {backupSnapshots.slice(0, 8).map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{formatDateTime(snapshot.createdAt)}</div>
                  <div className="text-xs text-foreground/50">
                    {formatBytes(snapshot.byteSize)} · {snapshot.reason}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => context.setRestoreCandidate(snapshot)}
                >
                  {label("prepareRestore", locale)}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-foreground/55">{label("noBackups", locale)}</div>
        )}
      </SettingsGroup>
      <details className="border border-danger/35 bg-panel" id="setting-data-reset">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-danger">
          {label("dangerZone", locale)}
        </summary>
        <div className="border-t border-danger/25 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-danger" size={18} />
            <div>
              <div className="text-sm font-medium">{label("clearDatabase", locale)}</div>
              <p className="mt-1 text-xs leading-5 text-foreground/60">
                {label("clearDatabaseDescription", locale)}
              </p>
            </div>
          </div>
          {context.databaseResetStep === "idle" && (
            <Button
              className="mt-4"
              variant="danger"
              onClick={() => context.setDatabaseResetStep("confirm")}
            >
              <Trash2 size={16} /> {label("clearDatabase", locale)}
            </Button>
          )}
          {context.databaseResetStep === "confirm" && (
            <div className="mt-4 border border-danger/40 bg-danger/10 p-3">
              <div className="text-sm font-medium">{label("secondConfirm", locale)}</div>
              <div className="mt-3 flex gap-2">
                <Button variant="danger" disabled={busy} onClick={() => void scheduleReset()}>
                  {label("backupAndReset", locale)}
                </Button>
                <Button variant="subtle" onClick={() => context.setDatabaseResetStep("idle")}>
                  {label("cancel", locale)}
                </Button>
              </div>
            </div>
          )}
          {context.databaseResetStep === "scheduled" && context.databaseResetSchedule && (
            <div className="mt-4 border border-accent/40 bg-accent/10 p-3 text-sm">
              <div>{label("resetScheduled", locale)}</div>
              <div className="mt-1 break-all text-xs">
                {displayPath(context.databaseResetSchedule.backupPath)}
              </div>
              <Button className="mt-3" onClick={() => void api.restartApplication()}>
                <RefreshCw size={16} /> {label("restart", locale)}
              </Button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function AdvancedSettings(context: SectionContext) {
  const developer = normalizeDeveloperModeSettings(context.settings);
  return (
    <div className="space-y-4">
      <SettingsGroup id="setting-advanced-logs" title={label("logs", context.locale)}>
        <Button variant="subtle" onClick={() => void api.openLogDir()}>
          <FolderOpen size={16} /> {label("openLogs", context.locale)}
        </Button>
        <div className="mt-3 divide-y divide-border">
          {context.logFiles.slice(0, 8).map((file) => (
            <div key={file.path} className="flex justify-between gap-3 py-2 text-sm">
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-foreground/50">
                {formatBytes(file.byteSize)}
              </span>
            </div>
          ))}
          {context.logFiles.length === 0 && (
            <div className="py-3 text-sm text-foreground/55">{label("noLogs", context.locale)}</div>
          )}
        </div>
      </SettingsGroup>
      <SettingsGroup
        id="setting-advanced-formats"
        title={label("formatCapabilities", context.locale)}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {context.formatCapabilities.map((capability) => (
            <div
              key={capability.format}
              className="flex items-center justify-between border border-border px-3 py-2 text-sm"
            >
              <span className="font-medium uppercase">{capability.format}</span>
              <span className={capability.available ? "text-emerald-500" : "text-amber-500"}>
                {capability.available
                  ? label("available", context.locale)
                  : label("toolRequired", context.locale)}
              </span>
            </div>
          ))}
        </div>
      </SettingsGroup>
      <SettingsGroup title={label("developerMode", context.locale)}>
        <SettingToggle
          id="advanced-developer"
          label={label("developerMode", context.locale)}
          description={label("developerModeDescription", context.locale)}
          enabled={developer.enabled}
          onToggle={() =>
            void context.setSettingValue("features.developer.enabled", !developer.enabled)
          }
        />
        {developer.enabled && (
          <p className="mt-2 text-xs text-foreground/55">
            {label("diagnosticsOnly", context.locale)}
          </p>
        )}
      </SettingsGroup>
    </div>
  );
}

function AboutSettings({ locale, update }: SectionContext) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsGroup id="setting-about-version" title="MangaVault Desktop">
        <InfoRow
          label={label("version", locale)}
          value={update ? `v${update.currentVersion}` : "v1.1.0 RC1"}
        />
        <InfoRow label={label("platform", locale)} value="Windows · macOS · Linux" />
      </SettingsGroup>
      <SettingsGroup id="setting-about-privacy" title={label("privacy", locale)}>
        <div className="flex gap-3">
          <ShieldCheck className="shrink-0 text-emerald-500" size={20} />
          <p className="text-sm leading-6 text-foreground/60">
            {label("privacyDescription", locale)}
          </p>
        </div>
      </SettingsGroup>
    </div>
  );
}

function SettingsNavButton({
  section,
  locale,
  active,
  onClick,
}: {
  section: (typeof settingsSections)[number];
  locale: Locale;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = section.icon;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
        active
          ? "bg-accent text-accentText"
          : "text-foreground/70 hover:bg-panelMuted hover:text-foreground",
        section.isAdvanced && !active && "mt-3 text-foreground/50",
      )}
    >
      <Icon size={17} />
      <span>{localizeSettingsText(section.title, locale)}</span>
    </button>
  );
}

function SettingsGroup({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className="border border-border bg-panel p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function SettingTarget({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={`setting-${id}`} tabIndex={-1}>
      {children}
    </div>
  );
}

function SettingSelect({
  id,
  icon: Icon,
  label: title,
  value,
  options,
  onChange,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label
      id={`setting-${id}`}
      tabIndex={-1}
      className="grid grid-cols-[auto_minmax(0,1fr)_minmax(150px,auto)] items-center gap-3 border-b border-border py-3 last:border-b-0"
    >
      <Icon size={16} className="text-foreground/45" />
      <span className="text-sm font-medium">{title}</span>
      <select
        value={value}
        aria-label={title}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
      >
        {options.map(([option, optionLabel]) => (
          <option key={option} value={option}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function SettingToggle({
  id,
  label: title,
  description,
  enabled,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      id={`setting-${id}`}
      tabIndex={-1}
      className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
    >
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-foreground/50">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={title}
        onClick={onToggle}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition",
          enabled ? "bg-accent" : "bg-panelMuted",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-4 w-4 rounded-full bg-white transition",
            enabled ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

function RangeSetting({
  id,
  label: title,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const submittedRef = useRef(value);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(value);
    draftRef.current = value;
    submittedRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const submit = (nextValue: number) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (submittedRef.current === nextValue) return;
    submittedRef.current = nextValue;
    onChange(nextValue);
  };

  const updateDraft = (nextValue: number) => {
    draftRef.current = nextValue;
    setDraft(nextValue);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => submit(nextValue), 160);
  };

  return (
    <label
      id={`setting-${id}`}
      tabIndex={-1}
      className="block border-b border-border py-3 last:border-b-0"
    >
      <span className="flex justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-foreground/55">{draft}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => updateDraft(Number(event.target.value))}
        onPointerUp={() => submit(draftRef.current)}
        onKeyUp={() => submit(draftRef.current)}
        className="mt-2 w-full accent-[hsl(var(--accent))]"
      />
    </label>
  );
}

function NumberSetting({
  id,
  label: title,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => onCommit(Math.min(max, Math.max(min, Number(draft) || value)));
  return (
    <label
      id={`setting-${id}`}
      tabIndex={-1}
      className="flex items-center justify-between gap-4 border-b border-border py-3"
    >
      <span className="text-sm font-medium">{title}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        className="h-9 w-28 rounded-md border border-border bg-background px-2 text-sm"
      />
    </label>
  );
}

function InfoRow({ label: title, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-foreground/55">{title}</span>
      <span className="max-w-[70%] break-all text-right font-medium">{value}</span>
    </div>
  );
}

function syncApplicationSettings(values: Record<string, unknown>) {
  syncLayoutSettings(values);
  syncBookActivationPreferences(values);
  syncReaderLaunchPreferences(values);
  syncShortcutBindings(values[SHORTCUT_SETTINGS_KEY]);
  setUiLocale(values.locale);
  applyTheme(normalizeTheme(values["appearance.theme"]));
}

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

type LabelKey = keyof typeof copy.zh;
function label(key: LabelKey | string, locale: Locale): string {
  const messages = locale === "zh-CN" ? copy.zh : copy.en;
  return messages[key as LabelKey] ?? key;
}

const copy = {
  zh: {
    settings: "设置",
    settingsSubtitle: "按使用场景管理 MangaVault",
    searchPlaceholder: "搜索设置",
    categories: "设置分类",
    resultCount: "找到 {count} 项设置",
    noResults: "没有匹配的设置",
    saving: "保存中",
    saved: "已保存",
    saveFailed: "保存失败",
    restoreSection: "恢复此分类默认",
    restoreSectionConfirm: "恢复此分类的 {count} 项设置？其他分类和用户数据不会受影响。",
    restoreFailed: "设置恢复失败",
    resetAllConfirm: "恢复全部应用偏好？漫画库、阅读进度、书签、历史和备份不会被删除。",
    system: "跟随系统",
    dark: "深色",
    light: "浅色",
    appearance: "外观",
    language: "语言",
    interface: "界面",
    sidebar: "主侧栏",
    expanded: "展开",
    compact: "折叠",
    quickActions: "快速操作",
    quickActionsDescription: "使用 Ctrl/Cmd+K 打开本地快速操作。",
    resetPreferences: "恢复应用偏好",
    resetPreferencesDescription: "只恢复界面、阅读器、快捷键和鼠标偏好，不删除任何用户数据。",
    resetAll: "全部恢复默认",
    browseAndOpen: "浏览与打开",
    gridDensity: "网格密度",
    comfortable: "舒适",
    spacious: "宽松",
    coverRatio: "封面比例",
    portrait: "竖版",
    square: "方形",
    tall: "长封面",
    openMouseAction: "打开漫画的鼠标操作",
    doubleClickOpen: "双击打开，单击选中",
    singleClickOpen: "单击直接打开",
    scanDefaults: "扫描默认值",
    recursiveScan: "递归扫描子目录",
    recursiveScanDescription: "添加目录时默认扫描其中的子目录。",
    foldersAndScanning: "目录与扫描",
    multipleFolders: "可以添加多个独立漫画目录；移除目录不会删除源文件。",
    addFolder: "添加漫画文件夹",
    libraryAdded: "漫画目录已添加",
    scanStarted: "重新扫描已开始",
    books: "本漫画",
    notScanned: "尚未扫描",
    openFolder: "打开文件夹",
    rescan: "重新扫描",
    remove: "移除",
    noLibraries: "尚未添加漫画文件夹",
    removeLibraryConfirm: "从 MangaVault 移除此目录？",
    removeLibraryScope:
      "将移除 {books} 本漫画的本地索引和 {bookmarks} 个关联书签；不会删除磁盘文件。",
    removeFromApp: "从 MangaVault 移除",
    cancel: "取消",
    libraryRemoved: "漫画目录已移除",
    formatDetails: "支持格式与本地工具状态",
    formatDetailsAdvanced: "详细能力状态位于“高级与诊断”，避免每次进入漫画库设置都重复探测工具。",
    jmComicSource: "JMComic 元数据来源",
    jmComicSourceDescription:
      "先只读预览 download.db 中的 JM ID 关联，再由你确认导入。联网元数据补全独立控制，默认关闭。",
    jmOnlineMetadata: "允许联网获取 JMComic 元数据",
    jmOnlineMetadataDescription:
      "开启后，手动刷新、确认的批量补全或你启用的导入后补全会向选定 HTTPS 服务发送 JM ID；不会上传漫画图片、路径或阅读记录。",
    metadataEndpoint: "元数据服务",
    metadataRefresh: "缓存刷新周期",
    autoMetadataAfterImport: "导入后元数据补全",
    manualOnly: "仅手动刷新",
    afterImport: "精确匹配 JM ID 后自动补全",
    days: "天",
    jmProviderStatus: "已关联 {linked} 本，已缓存 {cached} 本元数据",
    previewMetadataBatch: "预览批量补全",
    metadataBatchPreview: "将补全 {eligible} 本；{fresh} 本缓存仍有效，将跳过。",
    confirmMetadataBatch: "确认开始补全",
    cancelBatch: "停止批量补全",
    metadataBatchResult: "成功 {success} 本，失败 {failed} 本",
    discoverSource: "自动发现",
    discovering: "正在发现…",
    chooseDatabase: "选择 download.db",
    previewMatches: "预览关联",
    matching: "正在匹配…",
    jmComicNotFound: "未发现 JMComic 下载数据库，可手动选择 download.db",
    jmComicPreviewFailed: "无法读取 JMComic 数据库",
    discoveredSources: "发现的 JMComic 数据来源",
    downloadRecords: "条下载记录",
    sourceHealthy: "可读取",
    sourceInvalid: "不可读取",
    readOnlyPreview: "只读预览",
    sourceRecords: "来源记录",
    matched: "精确匹配",
    unmatched: "未匹配",
    missingSource: "源路径缺失",
    ambiguous: "存在歧义",
    previewDoesNotWrite: "预览仅读取一致性快照，不会修改 JMComic 或 MangaVault 数据库。",
    importJmIds: "导入 {count} 条 JM ID 关联",
    importingJmIds: "正在导入关联…",
    importJmIdsScope: "只保存已精确匹配的 JM ID 和来源路径，不获取网络元数据。",
    jmIdsImported: "JM ID 关联已导入",
    jmIdsImportedDetail: "新增 {linked}，已有 {unchanged}，冲突 {conflicts}",
    sourceWork: "JMComic 作品与逻辑路径",
    matchStatus: "关联状态",
    jmStatus_matched: "精确匹配",
    jmStatus_unmatched: "未匹配",
    jmStatus_ambiguous: "存在歧义",
    jmStatus_missing_source: "源路径缺失",
    previewFirstHundred:
      "当前显示前 100 条，共 {count} 条；完整关联将在后续批次提供虚拟化管理界面。",
    defaultReading: "默认阅读",
    readingMode: "阅读方式",
    singlePage: "单页",
    doublePage: "双页",
    continuousScroll: "连续滚动",
    direction: "阅读方向",
    ltr: "从左到右",
    rtl: "从右到左",
    fitMode: "适应方式",
    fitWidth: "适应宽度",
    fitHeight: "适应高度",
    originalSize: "原始尺寸",
    openState: "打开漫画后的界面状态",
    windowed: "普通窗口",
    focusReading: "专注阅读",
    rememberLast: "记住上次状态",
    readerInterface: "阅读界面",
    controlsLayout: "控制栏显示方式",
    automatic: "自动",
    overlay: "覆盖漫画",
    reserved: "预留空间",
    focusReadingDescription:
      "“专注阅读”会一次进入系统全屏并自动隐藏导航与控制栏；边缘热区和中央点击仍可唤醒控制。",
    imageDefaults: "图像默认值",
    brightness: "亮度",
    contrast: "对比度",
    saturation: "饱和度",
    grayscale: "灰度",
    grayscaleDescription: "默认以灰度方式显示漫画图片。",
    sharpen: "锐化",
    sharpenDescription: "默认启用图像锐化。",
    trimWhite: "去白边",
    trimWhiteDescription: "默认自动裁去页面白边。",
    readingBackground: "阅读背景",
    backgroundColor: "背景颜色",
    legacyEffect: "高级图像效果正在启用",
    legacyEffectDescription: "旧版反色兼容值仍在生效。可在此立即关闭，不会修改漫画源文件。",
    disableInvert: "关闭反色",
    memoryAndCache: "内存与缓存",
    lowMemory: "低内存模式",
    lowMemoryDescription: "降低阅读器预加载和缩略图缓存占用。",
    thumbnailLimit: "缩略图缓存上限 (MB)",
    cacheSafety: "清除缓存只删除可重新生成的页面和缩略图缓存，不会删除漫画库、进度、书签或源文件。",
    clearCache: "清除缓存",
    cacheCleared: "缓存已清除",
    databaseMaintenance: "数据库维护",
    databaseMaintenanceDescription: "ANALYZE 优化查询计划；VACUUM 回收空闲数据库空间。",
    optimized: "数据库优化完成",
    staleData: "失效数据",
    previewCleanup: "检查可清理项",
    cleanupSummary: "发现 {books} 本失效记录，相关缩略图约 {size}。",
    confirmCleanup: "确认清理",
    cleanupComplete: "失效数据已清理",
    healthAndLocation: "健康状态与位置",
    databaseHealth: "数据库健康",
    healthy: "正常",
    checking: "检查中",
    dataLocation: "本地数据位置",
    backup: "备份",
    backupNow: "立即备份数据库",
    backupDescription: "备份使用 WAL 一致快照，不会触碰原始漫画文件。",
    backupCreated: "数据库备份已创建",
    restore: "恢复",
    restorePending: "数据库恢复已安排，将在下次启动前执行。",
    restoreConfirm: "确认使用此备份恢复？当前数据库会先创建安全副本。",
    restoreOnRestart: "下次启动时恢复",
    prepareRestore: "准备恢复",
    noBackups: "尚无可用备份",
    dangerZone: "危险操作",
    clearDatabase: "清空 MangaVault 本地数据库",
    clearDatabaseDescription:
      "先创建并验证备份，再归档旧数据库并创建空数据库。漫画源文件和独立备份不会被删除。",
    secondConfirm: "这是高风险操作，请再次确认。",
    backupAndReset: "创建备份并准备清空",
    resetScheduled: "健康备份已创建，重启后将安全重新开始。",
    restart: "立即重启",
    logs: "日志",
    openLogs: "打开日志目录",
    noLogs: "尚无日志文件",
    formatCapabilities: "格式能力详情",
    available: "可用",
    toolRequired: "需要本地工具",
    developerMode: "开发者模式",
    developerModeDescription: "显示本地诊断信息；不会启用插件、AI、OCR 或同步。",
    diagnosticsOnly: "V1 仅显示诊断信息，未来扩展不会作为可用功能出现。",
    version: "版本",
    platform: "目标平台",
    privacy: "隐私与本地数据",
    privacyDescription:
      "MangaVault 默认完全离线运行，不上传漫画、阅读进度或本地路径。卸载默认保留此 Windows 用户账户中的应用数据。",
    actionFailed: "操作未完成",
  },
  en: {
    settings: "Settings",
    settingsSubtitle: "Manage MangaVault by task",
    searchPlaceholder: "Search settings",
    categories: "Settings categories",
    resultCount: "{count} settings found",
    noResults: "No matching settings",
    saving: "Saving",
    saved: "Saved",
    saveFailed: "Save failed",
    restoreSection: "Reset this category",
    restoreSectionConfirm:
      "Reset {count} settings in this category? Other categories and user data are not affected.",
    restoreFailed: "Could not restore settings",
    resetAllConfirm:
      "Reset all app preferences? Libraries, progress, bookmarks, history, and backups will be kept.",
    system: "System",
    dark: "Dark",
    light: "Light",
    appearance: "Appearance",
    language: "Language",
    interface: "Interface",
    sidebar: "Main sidebar",
    expanded: "Expanded",
    compact: "Compact",
    quickActions: "Quick actions",
    quickActionsDescription: "Open local quick actions with Ctrl/Cmd+K.",
    resetPreferences: "Reset app preferences",
    resetPreferencesDescription:
      "Resets interface, reader, shortcut, and mouse preferences only. User data is never deleted.",
    resetAll: "Reset all",
    browseAndOpen: "Browse & open",
    gridDensity: "Grid density",
    comfortable: "Comfortable",
    spacious: "Spacious",
    coverRatio: "Cover ratio",
    portrait: "Portrait",
    square: "Square",
    tall: "Tall",
    openMouseAction: "Mouse action to open manga",
    doubleClickOpen: "Double-click to open, single-click to select",
    singleClickOpen: "Single-click to open",
    scanDefaults: "Scan defaults",
    recursiveScan: "Scan subfolders",
    recursiveScanDescription: "Scan subfolders by default when adding a directory.",
    foldersAndScanning: "Folders & scanning",
    multipleFolders:
      "Add multiple independent manga folders. Removing one never deletes source files.",
    addFolder: "Add manga folder",
    libraryAdded: "Manga folder added",
    scanStarted: "Rescan started",
    books: "books",
    notScanned: "Not scanned",
    openFolder: "Open folder",
    rescan: "Rescan",
    remove: "Remove",
    noLibraries: "No manga folders added",
    removeLibraryConfirm: "Remove this folder from MangaVault?",
    removeLibraryScope:
      "Removes local indexes for {books} books and {bookmarks} related bookmarks. Files on disk are kept.",
    removeFromApp: "Remove from MangaVault",
    cancel: "Cancel",
    libraryRemoved: "Manga folder removed",
    formatDetails: "Supported formats and local tools",
    formatDetailsAdvanced:
      "Detailed capability status is under Advanced & Diagnostics so opening Library settings never repeats tool probes.",
    jmComicSource: "JMComic metadata source",
    jmComicSourceDescription:
      "Preview JM ID links from download.db first, then import only after confirmation. Online enrichment is separate and off by default.",
    jmOnlineMetadata: "Allow online JMComic metadata",
    jmOnlineMetadataDescription:
      "When enabled, manual refreshes, confirmed batches, or your enabled post-import enrichment send only the JM ID to the selected HTTPS service. Manga images, paths, and reading history are never uploaded.",
    metadataEndpoint: "Metadata service",
    metadataRefresh: "Cache refresh period",
    autoMetadataAfterImport: "Metadata after import",
    manualOnly: "Manual refresh only",
    afterImport: "Enrich after an exact JM ID match",
    days: "days",
    jmProviderStatus: "{linked} books linked, {cached} metadata records cached",
    previewMetadataBatch: "Preview batch enrichment",
    metadataBatchPreview:
      "{eligible} books will be enriched; {fresh} fresh cached records will be skipped.",
    confirmMetadataBatch: "Start enrichment",
    cancelBatch: "Stop batch",
    metadataBatchResult: "{success} succeeded, {failed} failed",
    discoverSource: "Discover",
    discovering: "Discovering…",
    chooseDatabase: "Choose download.db",
    previewMatches: "Preview matches",
    matching: "Matching…",
    jmComicNotFound: "No JMComic download database was found. You can select download.db manually.",
    jmComicPreviewFailed: "Could not read the JMComic database",
    discoveredSources: "Discovered JMComic sources",
    downloadRecords: "download records",
    sourceHealthy: "Readable",
    sourceInvalid: "Unreadable",
    readOnlyPreview: "Read-only preview",
    sourceRecords: "Source records",
    matched: "Exact matches",
    unmatched: "Unmatched",
    missingSource: "Missing source",
    ambiguous: "Ambiguous",
    previewDoesNotWrite:
      "The preview reads a consistent snapshot only. It does not modify either JMComic or MangaVault.",
    importJmIds: "Import {count} JM ID links",
    importingJmIds: "Importing links…",
    importJmIdsScope:
      "Stores exact JM ID and source-path links only; no network metadata is fetched.",
    jmIdsImported: "JM ID links imported",
    jmIdsImportedDetail: "{linked} new, {unchanged} unchanged, {conflicts} conflicts",
    sourceWork: "JMComic work and logical path",
    matchStatus: "Match status",
    jmStatus_matched: "Exact match",
    jmStatus_unmatched: "Unmatched",
    jmStatus_ambiguous: "Ambiguous",
    jmStatus_missing_source: "Missing source",
    previewFirstHundred:
      "Showing the first 100 of {count}. A virtualized management view will arrive in a later V1.1 batch.",
    defaultReading: "Default reading",
    readingMode: "Reading mode",
    singlePage: "Single page",
    doublePage: "Double page",
    continuousScroll: "Continuous scroll",
    direction: "Reading direction",
    ltr: "Left to right",
    rtl: "Right to left",
    fitMode: "Fit mode",
    fitWidth: "Fit width",
    fitHeight: "Fit height",
    originalSize: "Original size",
    openState: "State when opening manga",
    windowed: "Windowed",
    focusReading: "Focus reading",
    rememberLast: "Remember last state",
    readerInterface: "Reader interface",
    controlsLayout: "Control bar layout",
    automatic: "Automatic",
    overlay: "Overlay manga",
    reserved: "Reserve space",
    focusReadingDescription:
      "Focus Reading enters system fullscreen and auto-hides navigation and controls in one action. Edge zones and a center click still reveal controls.",
    imageDefaults: "Image defaults",
    brightness: "Brightness",
    contrast: "Contrast",
    saturation: "Saturation",
    grayscale: "Grayscale",
    grayscaleDescription: "Display manga images in grayscale by default.",
    sharpen: "Sharpen",
    sharpenDescription: "Enable image sharpening by default.",
    trimWhite: "Trim white borders",
    trimWhiteDescription: "Trim page borders by default.",
    readingBackground: "Reading background",
    backgroundColor: "Background color",
    legacyEffect: "Advanced image effect is active",
    legacyEffectDescription:
      "The legacy invert compatibility value is still active. Disable it here without changing source files.",
    disableInvert: "Disable invert",
    memoryAndCache: "Memory & cache",
    lowMemory: "Low memory mode",
    lowMemoryDescription: "Reduce reader preload and thumbnail cache usage.",
    thumbnailLimit: "Thumbnail cache limit (MB)",
    cacheSafety:
      "Clearing cache removes reproducible page and thumbnail data only. Libraries, progress, bookmarks, and source files are kept.",
    clearCache: "Clear cache",
    cacheCleared: "Cache cleared",
    databaseMaintenance: "Database maintenance",
    databaseMaintenanceDescription:
      "ANALYZE improves query planning; VACUUM reclaims free database space.",
    optimized: "Database optimization complete",
    staleData: "Stale data",
    previewCleanup: "Check cleanable items",
    cleanupSummary: "Found {books} stale books and about {size} of related thumbnails.",
    confirmCleanup: "Confirm cleanup",
    cleanupComplete: "Stale data cleaned",
    healthAndLocation: "Health & location",
    databaseHealth: "Database health",
    healthy: "Healthy",
    checking: "Checking",
    dataLocation: "Local data location",
    backup: "Backup",
    backupNow: "Back up database",
    backupDescription: "Backups use a WAL-consistent snapshot and never touch source manga files.",
    backupCreated: "Database backup created",
    restore: "Restore",
    restorePending: "Database restore is scheduled for the next startup.",
    restoreConfirm: "Restore this backup? A safety copy of the current database is created first.",
    restoreOnRestart: "Restore on restart",
    prepareRestore: "Prepare restore",
    noBackups: "No backups available",
    dangerZone: "Danger zone",
    clearDatabase: "Clear MangaVault local database",
    clearDatabaseDescription:
      "Creates and verifies a backup before archiving the old database and creating an empty one. Source manga and independent backups are kept.",
    secondConfirm: "This is a high-risk action. Confirm once more.",
    backupAndReset: "Back up and prepare reset",
    resetScheduled: "A healthy backup was created. Restart to safely start over.",
    restart: "Restart now",
    logs: "Logs",
    openLogs: "Open log folder",
    noLogs: "No log files yet",
    formatCapabilities: "Format capability details",
    available: "Available",
    toolRequired: "Local tool required",
    developerMode: "Developer mode",
    developerModeDescription:
      "Shows local diagnostics. It does not enable plugins, AI, OCR, or sync.",
    diagnosticsOnly:
      "V1 shows diagnostics only. Future extensions are not presented as working features.",
    version: "Version",
    platform: "Target platforms",
    privacy: "Privacy & local data",
    privacyDescription:
      "MangaVault runs fully offline by default and never uploads manga, reading progress, or local paths. Uninstalling keeps app data for this Windows user by default.",
    actionFailed: "Action could not be completed",
  },
} as const;
