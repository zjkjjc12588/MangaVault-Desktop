import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { StartupDataDialog } from "./components/StartupDataDialog";
import { Toaster } from "./components/Toaster";
import * as api from "./lib/api";
import { formatUserError, getUiLocale, setUiLocale, subscribeLocale, t } from "./lib/i18n";
import {
  getLayoutSettings,
  setPreferredSidebarMode,
  subscribeLayoutSettings,
  syncLayoutSettings,
  type AppRoute,
  type LayoutSettings,
} from "./lib/navigation";
import { syncBookActivationPreferences } from "./library/bookActivation";
import { applyTheme, normalizeTheme } from "./lib/theme";
import { getReaderPresentation, subscribeReaderPresentation } from "./lib/readerPresentation";
import { syncReaderLaunchPreferences } from "./lib/readerLaunch";
import { useLibraryStore } from "./stores/libraryStore";
import { useReaderStore } from "./stores/readerStore";
import { useToastStore } from "./stores/toastStore";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";
import { RecentPage } from "./pages/RecentPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { StartupDataStatus } from "./lib/types";
import {
  dispatchShortcutKeyboardEvent,
  SHORTCUT_SETTINGS_KEY,
  syncShortcutBindings,
} from "./shortcuts/shortcutRegistry";
import { useShortcutHandler } from "./shortcuts/useShortcut";

export function App() {
  const [route, setRoute] = useState<AppRoute>("library");
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [recentVisited, setRecentVisited] = useState(false);
  const [readerReturnLocation, setReaderReturnLocation] = useState<"library" | "recent">("library");
  const [startupStatus, setStartupStatus] = useState<StartupDataStatus | null>(null);
  const [startupAllowed, setStartupAllowed] = useState(false);
  const [startupError, setStartupError] = useState(false);
  const [outcomeDismissed, setOutcomeDismissed] = useState(false);
  const pushToast = useToastStore((state) => state.push);
  const sidebarWriteGeneration = useRef(0);
  const navigate = useCallback((nextRoute: AppRoute) => {
    if (nextRoute === "settings") setSettingsVisited(true);
    if (nextRoute === "recent") setRecentVisited(true);
    setRoute((currentRoute) => (currentRoute === nextRoute ? currentRoute : nextRoute));
  }, []);
  const layout = useSyncExternalStore(
    subscribeLayoutSettings,
    getLayoutSettings,
    getLayoutSettings,
  );
  const readerPresentation = useSyncExternalStore(
    subscribeReaderPresentation,
    getReaderPresentation,
    getReaderPresentation,
  );
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);

  const changeSidebarMode = useCallback(
    async (nextMode: LayoutSettings["sidebarMode"]) => {
      const previousMode = getLayoutSettings().sidebarMode;
      if (previousMode === nextMode) return;
      const generation = sidebarWriteGeneration.current + 1;
      sidebarWriteGeneration.current = generation;
      setPreferredSidebarMode(nextMode);
      try {
        const settings = await api.setSetting("ui.layout.sidebar_mode", nextMode);
        if (generation === sidebarWriteGeneration.current) syncLayoutSettings(settings);
      } catch (error) {
        if (generation === sidebarWriteGeneration.current) {
          setPreferredSidebarMode(previousMode);
          pushToast({
            title: t("settingSaveFailed"),
            description: formatUserError(error),
            tone: "error",
          });
        }
      }
    },
    [pushToast],
  );

  useShortcutHandler(
    "global.openLibrary",
    () => {
      navigate("library");
      return true;
    },
    startupAllowed,
  );
  useShortcutHandler(
    "global.openReader",
    () => {
      navigate("reader");
      return true;
    },
    startupAllowed,
  );
  useShortcutHandler(
    "global.openRecent",
    () => {
      navigate("recent");
      return true;
    },
    startupAllowed,
  );
  useShortcutHandler(
    "global.openSettings",
    () => {
      navigate("settings");
      return true;
    },
    startupAllowed,
  );
  useShortcutHandler(
    "library.importFolder",
    () => {
      void useLibraryStore.getState().importFolder();
      return true;
    },
    startupAllowed && route === "library",
  );
  useShortcutHandler(
    "library.importFile",
    () => {
      void useLibraryStore.getState().importFiles();
      return true;
    },
    startupAllowed && route === "library",
  );

  useEffect(() => {
    let disposed = false;
    let theme = normalizeTheme("system");
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => applyTheme(theme);
    applyTheme(theme);
    void Promise.all([api.getSettings(), api.getStartupDataStatus()])
      .then(([settings, status]) => {
        if (disposed) return;
        theme = normalizeTheme(settings["appearance.theme"]);
        setUiLocale(settings.locale);
        syncLayoutSettings(settings);
        syncBookActivationPreferences(settings);
        syncReaderLaunchPreferences(settings);
        syncShortcutBindings(settings[SHORTCUT_SETTINGS_KEY]);
        applyTheme(theme);
        setStartupStatus(status);
        setStartupAllowed(!status.shouldPrompt);
      })
      .catch(() => {
        if (!disposed) setStartupError(true);
      });
    media.addEventListener("change", syncSystemTheme);
    return () => {
      disposed = true;
      media.removeEventListener("change", syncSystemTheme);
    };
  }, []);

  useEffect(() => {
    if (!startupAllowed) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<string[]>("associated-file-opened", (event) => {
      void importAssociatedPaths(event.payload, navigate).catch(() => undefined);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate, startupAllowed]);

  useEffect(() => {
    if (!startupAllowed) return;
    let disposed = false;
    void api
      .takeLaunchPaths()
      .then((paths) => {
        if (!disposed) return importAssociatedPaths(paths, navigate);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [navigate, startupAllowed]);

  useEffect(() => {
    if (!startupAllowed) return;
    window.addEventListener("keydown", dispatchShortcutKeyboardEvent, true);
    return () => window.removeEventListener("keydown", dispatchShortcutKeyboardEvent, true);
  }, [startupAllowed]);

  const continueExistingData = useCallback(async () => {
    await api.acknowledgeExistingData();
    setStartupStatus((current) => (current ? { ...current, shouldPrompt: false } : current));
    setStartupAllowed(true);
  }, []);

  if (startupError) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-background p-6 text-foreground">
        <div className="max-w-md border border-danger/40 bg-panel p-5 text-sm text-danger">
          {t("startupDataError")}
        </div>
      </div>
    );
  }

  if (!startupStatus) {
    return <div className="h-screen w-screen bg-background" aria-busy="true" />;
  }

  const showResetOutcome = Boolean(startupStatus.resetOutcome) && !outcomeDismissed;

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {startupAllowed && readerPresentation === "normal" && (
          <Sidebar
            route={route}
            onRoute={navigate}
            preferredMode={layout.sidebarMode}
            onPreferredModeChange={(mode) => void changeSidebarMode(mode)}
          />
        )}
        {startupAllowed && route === "library" && (
          <LibraryPage
            onOpenReader={() => {
              setReaderReturnLocation("library");
              navigate("reader");
            }}
          />
        )}
        {startupAllowed && recentVisited && (
          <div className={route === "recent" ? "contents" : "hidden"}>
            <RecentPage
              active={route === "recent"}
              onOpenReader={() => {
                setReaderReturnLocation("recent");
                navigate("reader");
              }}
              onOpenLibrary={() => navigate("library")}
            />
          </div>
        )}
        {startupAllowed && route === "reader" && (
          <ReaderPage
            returnLocation={readerReturnLocation}
            onReturn={() => navigate(readerReturnLocation)}
          />
        )}
        {startupAllowed && settingsVisited && (
          <div className={route === "settings" ? "contents" : "hidden"}>
            <SettingsPage />
          </div>
        )}
        {startupAllowed && layout.commandPaletteEnabled && <CommandPalette route={route} />}
        <Toaster />
        {(showResetOutcome || (!startupAllowed && startupStatus.shouldPrompt)) && (
          <StartupDataDialog
            status={startupStatus}
            showOutcome={showResetOutcome}
            onContinue={continueExistingData}
            onDismissOutcome={() => setOutcomeDismissed(true)}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

const ASSOCIATED_ARCHIVE_PATTERN = /\.(cbz|cbr|zip|rar|7z|pdf)$/i;
const ASSOCIATED_SCAN_TIMEOUT_MS = 120_000;
const ASSOCIATED_SCAN_POLL_MS = 350;

async function importAssociatedPaths(
  paths: string[],
  setRoute: (route: AppRoute) => void,
): Promise<void> {
  const candidates = paths.filter(Boolean);
  if (candidates.length === 0) return;
  setRoute("library");
  const jobs = await useLibraryStore.getState().importPaths(candidates);
  const archivePath = candidates.find((path) => ASSOCIATED_ARCHIVE_PATTERN.test(path));
  if (!archivePath || jobs.length === 0) return;

  const book = await waitForAssociatedBook(archivePath, new Set(jobs.map((job) => job.jobId)));
  if (!book) return;
  await useReaderStore.getState().openBook(book);
  setRoute("reader");
}

async function waitForAssociatedBook(path: string, jobIds: Set<number>) {
  const deadline = Date.now() + ASSOCIATED_SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const jobs = await api.listScanJobs().catch(() => []);
    const trackedJobs = jobs.filter((job) => jobIds.has(job.id));
    if (
      trackedJobs.length > 0 &&
      trackedJobs.every((job) =>
        ["complete", "failed", "cancelled", "interrupted"].includes(job.status),
      )
    ) {
      if (!trackedJobs.some((job) => job.status === "complete")) return null;
      return api.getBookByPath(path).catch(() => null);
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, ASSOCIATED_SCAN_POLL_MS));
  }
  return null;
}
