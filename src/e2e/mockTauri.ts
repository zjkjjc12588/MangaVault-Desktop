import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  Book,
  BookPage,
  Bookmark,
  Chapter,
  DatabaseRestoreStatus,
  FeatureFlagRecord,
  LicenseStateRecord,
  OcrTranslationStatus,
  PagePayload,
  PluginStatusRecord,
  ReaderProfileRecord,
  ReaderSettingsScopeCounts,
  ReadingProgress,
  ReadingHistoryItem,
  RecentReadingFilter,
  RecentReadingSort,
  ScanJob,
  SmartCollectionRecord,
  SyncStatusRecord,
  TelemetrySettingRecord,
} from "../lib/types";

const imageDataUrl =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360" viewBox="0 0 240 360">
      <rect width="240" height="360" fill="#151a22"/>
      <rect x="18" y="18" width="204" height="324" rx="6" fill="#263244"/>
      <text x="120" y="180" fill="#d8efe8" text-anchor="middle" font-size="32" font-family="sans-serif">MV</text>
    </svg>`,
  );

const emptyLibraryMode = window.location.search.includes("empty-library=1");
const newUserMode = window.location.search.includes("new-user=1");
const existingDataMode = window.location.search.includes("existing-data=1");
const longPathMode = window.location.search.includes("long-path=1");
const failedScanMode = window.location.search.includes("failed-scan=1");
const deletedCleanupMode = window.location.search.includes("deleted-cleanup=1");
const metadataFailureMode = window.location.search.includes("metadata-fail=1");
const queryParameters = new globalThis.URLSearchParams(window.location.search);
const settingFailureKey = queryParameters.get("setting-fail");
const protectedDataMode = queryParameters.has("protected-data");
const requestedReaderPageCount = Number(queryParameters.get("reader-pages") ?? "3");
const readerPageCount = Number.isFinite(requestedReaderPageCount)
  ? Math.min(2_000, Math.max(1, Math.trunc(requestedReaderPageCount)))
  : 3;
const readerMode = parseReaderMode(queryParameters.get("reader-mode"));
const readerControlsLayout = parseReaderControlsLayout(
  queryParameters.get("reader-controls-layout"),
);
const readerPageDelay = Math.max(0, Number(queryParameters.get("page-delay") ?? "0") || 0);
const readerPageDelays = parsePageNumberMap(queryParameters.get("page-delay-map"));
const readerPageFailures = new Set(
  (queryParameters.get("page-fail") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger),
);
const persistedShortcutBindings = readPersistedShortcutBindings();
const persistedSidebarMode = readPersistedSetting("mangavault.e2e.sidebar-mode", [
  "expanded",
  "compact",
]);
const persistedBookOpenAction = readPersistedSetting("mangavault.e2e.book-open-action", [
  "double",
  "single",
]);
const persistedReaderLaunchState = readPersistedSetting("mangavault.e2e.reader-launch-state", [
  "windowed",
  "focus",
  "remember",
]);
const persistedSettingsSection = readPersistedSetting("mangavault.e2e.settings-section", [
  "general",
  "library",
  "reader",
  "display",
  "input",
  "storage",
  "data",
  "advanced",
  "about",
]);
const persistedRecentView = readPersistedSetting("mangavault.e2e.recent-view", ["grid", "list"]);
const persistedRecentSort = readPersistedSetting("mangavault.e2e.recent-sort", [
  "recent",
  "progress",
  "title",
]);
const persistedRecentFilter = readPersistedSetting("mangavault.e2e.recent-filter", [
  "all",
  "unfinished",
  "finished",
  "today",
  "7days",
  "30days",
]);
const persistedLastStableReaderState = readPersistedSetting(
  "mangavault.e2e.reader-last-stable-state",
  ["windowed", "focus"],
);
const readerLaunchState =
  readQuerySetting(queryParameters.get("reader-launch"), ["windowed", "focus", "remember"]) ??
  persistedReaderLaunchState ??
  "windowed";
const lastStableReaderState =
  readQuerySetting(queryParameters.get("reader-last-stable"), ["windowed", "focus"]) ??
  persistedLastStableReaderState ??
  "windowed";

const books: Book[] = [
  {
    id: 1,
    libraryId: 1,
    seriesId: 1,
    title: "Cyber Orchard Vol. 1",
    sortTitle: "cyber orchard vol. 1",
    author: "MangaVault Lab",
    volume: 1,
    chapter: 1,
    path: "D:/MangaVaultFixtures/Cyber Orchard Vol. 1",
    format: "folder",
    fileSize: 2048,
    modifiedAt: "2026-07-08T00:00:00Z",
    pageCount: readerPageCount,
    coverPageIndex: 0,
    coverCacheKey: null,
    isFavorite: false,
    rating: 4,
    status: "available",
    importedAt: "2026-07-08T00:00:00Z",
    updatedAt: "2026-07-08T00:00:00Z",
    lastReadAt: null,
    progressPercent: 0,
    tags: ["e2e"],
  },
  {
    id: 2,
    libraryId: 1,
    seriesId: 2,
    title: "Quiet Signal",
    sortTitle: "quiet signal",
    author: "MangaVault Lab",
    volume: 1,
    chapter: 2,
    path: "D:/MangaVaultFixtures/Quiet Signal.cbz",
    format: "cbz",
    fileSize: 4096,
    modifiedAt: "2026-07-08T00:00:00Z",
    pageCount: 2,
    coverPageIndex: 0,
    coverCacheKey: null,
    isFavorite: false,
    rating: 3,
    status: "missing",
    importedAt: "2026-07-08T00:00:00Z",
    updatedAt: "2026-07-08T00:00:00Z",
    lastReadAt: null,
    progressPercent: 0,
    tags: ["e2e"],
  },
  ...Array.from({ length: 240 }, (_, index): Book => {
    const id = index + 3;
    const number = String(index + 1).padStart(4, "0");
    return {
      id,
      libraryId: 1,
      seriesId: id,
      title: `Library Book ${number}`,
      sortTitle: `library book ${number}`,
      author: "MangaVault Lab",
      volume: null,
      chapter: null,
      path: `D:/MangaVaultFixtures/Library Book ${number}.cbz`,
      format: "cbz",
      fileSize: 1024,
      modifiedAt: "2026-07-08T00:00:00Z",
      pageCount: 1,
      coverPageIndex: 0,
      coverCacheKey: null,
      isFavorite: false,
      rating: 0,
      status: "available",
      importedAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
      lastReadAt: null,
      progressPercent: 0,
      tags: [],
    };
  }),
];

const requestedRecentCount = Math.min(
  10_000,
  Math.max(1, Number(queryParameters.get("recent-count") ?? "1") || 1),
);
if (requestedRecentCount > books.length) {
  const template = books[2];
  for (let index = books.length; index < requestedRecentCount; index += 1) {
    const id = index + 1;
    books.push({
      ...template,
      id,
      seriesId: id,
      title: `Recent Book ${String(id).padStart(5, "0")}`,
      sortTitle: `recent book ${String(id).padStart(5, "0")}`,
      path: `D:/MangaVaultFixtures/Recent Book ${String(id).padStart(5, "0")}.cbz`,
    });
  }
}
const booksById = new Map(books.map((book) => [book.id, book]));
const initialRecentHistory: ReadingHistoryItem[] = Array.from(
  { length: requestedRecentCount },
  (_, index) => {
    const book = books[index];
    return {
      bookId: book.id,
      title: book.title,
      pageIndex: Math.min(1, Math.max(0, book.pageCount - 1)),
      totalPages: book.pageCount,
      openedAt: new Date(Date.UTC(2026, 6, 22, 12, 0) - index * 60_000).toISOString(),
      path: book.path,
    };
  },
);

const pages: BookPage[] = Array.from({ length: readerPageCount }, (_, pageIndex) => ({
  id: pageIndex + 1,
  bookId: 1,
  pageIndex,
  sourcePath: `${pageIndex + 1}.png`,
  width: 240,
  height: 360,
  byteSize: 128,
}));

const chapters: Chapter[] = [
  {
    id: 1,
    bookId: 1,
    title: "Cyber Orchard Vol. 1",
    chapterNumber: 1,
    startPage: 0,
    pageCount: 3,
    createdAt: "2026-07-08T00:00:00Z",
  },
];

const state = {
  calls: [] as Array<{ cmd: string; args: unknown }>,
  jobs: (failedScanMode
    ? [
        {
          id: 71,
          libraryId: 1,
          rootPath: "D:/MangaVaultFixtures",
          status: "interrupted",
          discoveredCount: 12,
          importedCount: 8,
          failedCount: 1,
          message: "interrupted by previous app shutdown",
          startedAt: "2026-07-08T00:00:00Z",
          finishedAt: "2026-07-08T00:00:05Z",
        },
      ]
    : []) as ScanJob[],
  bookmarks: (protectedDataMode
    ? [{ id: 1, bookId: 1, pageIndex: 1, note: null, createdAt: "2026-07-22" }]
    : []) as Bookmark[],
  progress: (protectedDataMode
    ? {
        bookId: 1,
        currentPage: 1,
        totalPages: 3,
        percent: 2 / 3,
        mode: "single",
        direction: "ltr",
        updatedAt: "2026-07-22T10:00:00Z",
      }
    : null) as ReadingProgress | null,
  history: initialRecentHistory,
  readerProfiles: [
    {
      id: 1,
      profileId: "global.default",
      name: "Default",
      mode: "single",
      direction: "ltr",
      fit: "width",
      settings: { zoom: 100 },
      createdAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
    },
  ] as ReaderProfileRecord[],
  readerScopeCounts: {
    bookSettings: 0,
    seriesSettings: 0,
  } as ReaderSettingsScopeCounts,
  smartCollections: [
    {
      id: 1,
      name: "Favorites",
      query: { favorite: true, sort: "title" },
      enabled: true,
      createdAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
    },
  ] as SmartCollectionRecord[],
  featureFlags: [
    {
      key: "telemetry.enabled",
      enabled: false,
      createdAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
    },
    {
      key: "developer.enabled",
      enabled: false,
      createdAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
    },
  ] as FeatureFlagRecord[],
  license: {
    status: "community",
    licenseKeyPresent: false,
    metadata: { offline: true },
    createdAt: "2026-07-08T00:00:00Z",
    updatedAt: "2026-07-08T00:00:00Z",
  } as LicenseStateRecord,
  telemetrySettings: [
    {
      key: "anonymous_diagnostics",
      enabled: false,
      value: false,
      createdAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
    },
  ] as TelemetrySettingRecord[],
  ocrTranslationStatus: {
    ocrEnabled: false,
    translationEnabled: false,
    ocrProviderId: null,
    translationProviderId: null,
    ocrLocale: "ja",
    sourceLocale: "ja",
    targetLocale: "zh-CN",
    ocrCacheEntries: 0,
    translationCacheEntries: 0,
  } as OcrTranslationStatus,
  syncStatus: {
    enabled: false,
    providerId: null,
    automaticSync: false,
    encryptionRequired: true,
    conflictStrategy: "manual",
    configuredProviders: 0,
    logEntries: 0,
    lastSyncAt: null,
  } as SyncStatusRecord,
  pluginStatus: {
    enabled: false,
    manifestCount: 0,
    enabledManifestCount: 0,
    settingsCount: 0,
    dynamicExecutionEnabled: false,
    pluginDirectory: "plugins",
    exampleManifestPath: "plugins/examples/manifest.example.json",
  } as PluginStatusRecord,
  databaseRestoreStatus: {
    pendingSnapshot: null,
  } as DatabaseRestoreStatus,
  logFiles: [
    {
      name: "mangavault.log",
      path: "D:/MangaVaultLogs/mangavault.log",
      byteSize: 128,
      modifiedAt: "2026-07-08T00:00:00Z",
    },
  ],
  settings: {
    "appearance.theme": "dark",
    locale: "zh-CN",
    "reader.zoom": 100,
    "reader.mode": readerMode,
    "reader.controls_layout": readerControlsLayout,
    "reader.night": queryParameters.get("legacy-invert") === "1",
    "reader.pointer.side_paging": true,
    "reader.pointer.center_controls": true,
    "reader.pointer.double_click_zoom": true,
    "reader.pointer.double_click_interval": 350,
    "reader.pointer.ctrl_wheel_zoom": true,
    "reader.pointer.wheel_page_turn": true,
    "reader.pointer.drag_pan": true,
    "shortcuts.user_bindings": persistedShortcutBindings,
    "reader.tutorial_seen":
      new globalThis.URLSearchParams(window.location.search).get("reader-tutorial") !== "1",
    "reader.fullscreen_hint_seen":
      new globalThis.URLSearchParams(window.location.search).get("reader-tutorial") !== "1" &&
      new globalThis.URLSearchParams(window.location.search).get("focus-hint") !== "1",
    "reader.launch_state": readerLaunchState,
    "reader.last_stable_state": lastStableReaderState,
    "ui.layout.sidebar_mode": persistedSidebarMode ?? "expanded",
    "library.open_mouse_action": persistedBookOpenAction ?? "double",
    "ui.settings.section": persistedSettingsSection ?? "general",
    "recent.view": persistedRecentView ?? "list",
    "recent.sort": persistedRecentSort ?? "recent",
    "recent.filter": persistedRecentFilter ?? "all",
    "ui.layout.grid_density": "comfortable",
    "ui.layout.cover_aspect_ratio": "portrait",
    "ui.command_palette.enabled": true,
    "ui.shortcuts.custom_enabled": false,
    "metadata.jmcomic.enabled": false,
    "metadata.jmcomic.endpoint": "https://www.cdngwc.cc",
    "metadata.jmcomic.refresh_days": 30,
    "metadata.jmcomic.request_interval_ms": 1200,
    "features.developer.enabled": false,
    "features.plugins.enabled": false,
    "developer.command_debugger.enabled": false,
    "developer.profiler.enabled": false,
    "developer.database_browser.enabled": false,
    "features.sync.enabled": false,
    "sync.provider_id": null,
    "sync.automatic_enabled": false,
    "sync.encryption_required": true,
    "sync.conflict_strategy": "manual",
    "features.ocr.enabled": false,
    "features.translation.enabled": false,
    "ocr.provider_id": null,
    "ocr.default_locale": "ja",
    "translation.provider_id": null,
    "translation.source_locale": "ja",
    "translation.target_locale": "zh-CN",
    "translation.overlay.enabled": false,
  } as Record<string, unknown>,
  libraries: [
    {
      id: 1,
      name: "MangaVaultFixtures",
      rootPath: "D:/MangaVaultFixtures",
      recursive: true,
      createdAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
      lastScanAt: null,
      bookCount: books.length,
    },
  ],
  existingDataAcknowledged: false,
};

if (longPathMode) {
  state.libraries[0].rootPath = String.raw`\\?\D:\漫画\作品`;
  state.history[0].path = String.raw`\\?\D:\漫画\作品\Cyber Orchard Vol. 1`;
}

declare global {
  interface Window {
    __MANGAVAULT_E2E__?: typeof state;
  }
}

window.__MANGAVAULT_E2E__ = state;

mockIPC((cmd, args = {}) => {
  state.calls.push({ cmd, args });
  switch (cmd) {
    case "take_launch_paths":
      return [];
    case "choose_import_folder":
      return "D:/MangaVaultFixtures";
    case "choose_import_files":
      return ["D:/MangaVaultFixtures/Cyber Orchard Vol. 1.cbz"];
    case "choose_jmcomic_database":
      return "D:/JMComicFixture/data/download.db";
    case "discover_jmcomic_sources":
      return [
        {
          databasePath: "D:/JMComicFixture/data/download.db",
          dataDirectory: "D:/JMComicFixture/data",
          downloadCount: 2,
          existingSourceCount: 2,
          modifiedAt: "2026-08-13T00:00:00Z",
          healthy: true,
          message: null,
        },
      ];
    case "preview_jmcomic_matches":
      return {
        databasePath: "D:/JMComicFixture/data/download.db",
        sourceRecords: 2,
        matched: 1,
        unmatched: 1,
        ambiguous: 0,
        missingSource: 0,
        generatedAt: "2026-08-13T00:00:00Z",
        previewToken: "fixture-preview-token",
        readOnly: true,
        items: [
          {
            jmId: "10001",
            sourceTitle: "Exact fixture work",
            sourcePath: "D:/MangaVaultFixtures/Exact fixture work/original",
            logicalRootPath: "D:/MangaVaultFixtures/Exact fixture work",
            sourcePathExists: true,
            bookId: 1,
            currentTitle: "Cyber Orchard Vol. 1",
            status: "matched",
            matchMethod: "exact_logical_root",
          },
          {
            jmId: "10002",
            sourceTitle: "Unmatched fixture work",
            sourcePath: "D:/MangaVaultFixtures/Unmatched fixture work/original",
            logicalRootPath: "D:/MangaVaultFixtures/Unmatched fixture work",
            sourcePathExists: true,
            bookId: null,
            currentTitle: null,
            status: "unmatched",
            matchMethod: null,
          },
        ],
      };
    case "import_jmcomic_identities":
      return { linked: 1, unchanged: 0, conflicts: 0, skipped: 0 };
    case "get_jmcomic_provider_status":
      return {
        enabled: state.settings["metadata.jmcomic.enabled"] === true,
        endpoint: state.settings["metadata.jmcomic.endpoint"],
        refreshDays: state.settings["metadata.jmcomic.refresh_days"],
        requestIntervalMs: state.settings["metadata.jmcomic.request_interval_ms"],
        linkedBooks: 1,
        cachedBooks: 0,
        queuedJobs: 0,
        runningJobs: 0,
      };
    case "get_jmcomic_metadata":
      return null;
    case "get_jmcomic_book_source": {
      const bookId = (args as { bookId: number }).bookId;
      if (bookId !== 1) return null;
      return {
        identity: {
          bookId: 1,
          providerId: "jmcomic",
          remoteId: "10001",
          matchMethod: "download_db_exact_path",
          matchConfidence: 1,
          canonicalSourcePath: "D:/MangaVaultFixtures/Exact fixture work",
          createdAt: "2026-08-13T00:00:00Z",
          updatedAt: "2026-08-13T00:00:00Z",
        },
        metadata: {
          bookId: 1,
          providerId: "jmcomic",
          remoteId: "10001",
          originalTitle: "JM Source Title",
          authors: ["JM Author"],
          categories: ["Manga"],
          tags: ["冒险", "彩色"],
          description: "JM source description",
          chapters: [],
          remoteCoverUrl: null,
          fetchedAt: "2026-08-13T00:00:00Z",
          expiresAt: "2026-09-12T00:00:00Z",
          status: "fresh",
          errorMessage: null,
        },
        mergePreview: null,
      };
    }
    case "refresh_jmcomic_metadata":
      return {
        bookId: 1,
        providerId: "jmcomic",
        remoteId: "10001",
        fields: [],
        sourceTags: ["冒险", "彩色"],
        cachedAt: "2026-08-13T00:00:00Z",
      };
    case "list_jmcomic_metadata_jobs":
      return [];
    case "preview_jmcomic_metadata_batch":
      return {
        previewToken: "metadata-batch-token",
        totalLinked: 1,
        eligible: 1,
        freshCached: 0,
        generatedAt: "2026-08-13T00:00:00Z",
        force: false,
      };
    case "run_jmcomic_metadata_batch":
      return { requested: 1, succeeded: 1, failed: 0, cancelled: false };
    case "cancel_jmcomic_metadata_batch":
      return null;
    case "import_folder":
    case "import_paths":
      state.jobs = [
        {
          id: 77,
          libraryId: 1,
          rootPath: "D:/MangaVaultFixtures",
          status: "running",
          discoveredCount: 2,
          importedCount: 1,
          failedCount: 0,
          message: null,
          startedAt: "2026-07-08T00:00:00Z",
          finishedAt: null,
        },
      ];
      return { jobId: 77, status: "running" };
    case "cancel_scan":
      state.jobs = state.jobs.map((job) =>
        job.id === (args as { jobId: number }).jobId
          ? { ...job, status: "cancelling", message: "cancelling" }
          : job,
      );
      return null;
    case "retry_scan":
      state.jobs = [
        {
          id: 78,
          libraryId: 1,
          rootPath: "D:/MangaVaultFixtures",
          status: "queued",
          discoveredCount: 0,
          importedCount: 0,
          failedCount: 0,
          message: null,
          startedAt: "2026-07-08T00:01:00Z",
          finishedAt: null,
        },
      ];
      return { jobId: 78, status: "queued" };
    case "list_scan_jobs":
      return state.jobs;
    case "list_scan_failures":
      return failedScanMode
        ? [
            {
              id: 1,
              scanJobId: 71,
              path: "D:/MangaVaultFixtures/broken.cbz",
              stage: "index",
              message: "zip error: invalid central directory",
              createdAt: "2026-07-08T00:00:01Z",
            },
          ]
        : [];
    case "list_history":
      return state.history;
    case "list_recent_reading": {
      const query =
        (
          args as {
            query?: {
              search?: string;
              filter?: RecentReadingFilter;
              sort?: RecentReadingSort;
              limit?: number;
              offset?: number;
            };
          }
        ).query ?? {};
      const unique = Array.from(new Map(state.history.map((item) => [item.bookId, item])).values())
        .map((history) => {
          const book = booksById.get(history.bookId);
          if (!book || book.status === "deleted") return null;
          const progress = state.progress?.bookId === book.id ? state.progress : null;
          const currentPage = progress?.currentPage ?? history.pageIndex;
          const totalPages = progress?.totalPages ?? history.totalPages;
          const progressPercent = progress?.percent ?? Math.min(1, (currentPage + 1) / totalPages);
          return {
            book: { ...book, progressPercent },
            currentPage,
            totalPages,
            progressPercent,
            lastReadAt: history.openedAt,
            isFinished: progressPercent >= 0.999,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .filter((item) => {
          const search = query.search?.toLowerCase().trim();
          if (
            search &&
            !`${item.book.title} ${item.book.author ?? ""}`.toLowerCase().includes(search)
          ) {
            return false;
          }
          if (query.filter === "finished") return item.isFinished;
          if (query.filter === "unfinished") return !item.isFinished;
          if (["today", "7days", "30days"].includes(query.filter ?? "")) {
            const openedAt = new Date(item.lastReadAt).getTime();
            const now = Date.now();
            if (query.filter === "today") {
              const opened = new Date(openedAt);
              const today = new Date(now);
              return (
                opened.getFullYear() === today.getFullYear() &&
                opened.getMonth() === today.getMonth() &&
                opened.getDate() === today.getDate()
              );
            }
            const days = query.filter === "7days" ? 7 : 30;
            return openedAt >= now - days * 24 * 60 * 60 * 1000;
          }
          return true;
        });
      if (query.sort === "title")
        unique.sort((left, right) => left.book.title.localeCompare(right.book.title));
      if (query.sort === "progress")
        unique.sort((left, right) => right.progressPercent - left.progressPercent);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 80;
      return { items: unique.slice(offset, offset + limit), total: unique.length, offset, limit };
    }
    case "list_libraries":
      return newUserMode ? [] : state.libraries;
    case "get_startup_data_status":
      return {
        appDataPath: String.raw`\\?\D:\MangaVaultData`,
        hadExistingDatabase: existingDataMode,
        shouldPrompt: existingDataMode && !state.existingDataAcknowledged,
        summary: {
          libraries: newUserMode ? 0 : state.libraries.length,
          books: newUserMode ? 0 : books.length,
          readingHistory: newUserMode ? 0 : state.history.length,
          readingProgress: state.progress ? 1 : 0,
          bookmarks: state.bookmarks.length,
        },
        resetOutcome: null,
      };
    case "acknowledge_existing_data":
      state.existingDataAcknowledged = true;
      return null;
    case "schedule_database_reset":
      return {
        backupPath: String.raw`\\?\D:\MangaVaultData\mangavault.backup.sqlite3`,
        scheduledAt: "2026-07-14T00:00:00Z",
        restartRequired: true,
      };
    case "restart_application":
      return null;
    case "list_reader_profiles":
      return state.readerProfiles;
    case "reader_settings_scope_counts":
      return state.readerScopeCounts;
    case "list_smart_collections":
      return state.smartCollections;
    case "rescan_library":
      return { jobId: 78, status: "running" };
    case "purge_missing_books":
      return { removed: 1 };
    case "get_deleted_book_cleanup_preview":
      return deletedCleanupMode
        ? { books: 3, pages: 48, chapters: 3, thumbnails: 3, thumbnailBytes: 4096 }
        : { books: 0, pages: 0, chapters: 0, thumbnails: 0, thumbnailBytes: 0 };
    case "purge_deleted_books":
      return {
        booksRemoved: deletedCleanupMode ? 3 : 0,
        pagesRemoved: deletedCleanupMode ? 48 : 0,
        chaptersRemoved: deletedCleanupMode ? 3 : 0,
        thumbnailRecordsRemoved: deletedCleanupMode ? 3 : 0,
        thumbnailFilesRemoved: deletedCleanupMode ? 3 : 0,
      };
    case "optimize_database":
      return {
        vacuum: Boolean((args as { vacuum?: boolean }).vacuum),
        pageCountBefore: 10,
        pageCountAfter: 10,
        freelistCountBefore: 1,
        freelistCountAfter: 0,
        elapsedMs: 5,
      };
    case "open_path_in_shell":
    case "open_log_dir":
      return null;
    case "list_log_files":
      return state.logFiles;
    case "get_format_capabilities":
      return [
        { format: "cbz", available: true, detail: "built-in" },
        { format: "rar", available: true, detail: "7z" },
        { format: "7z", available: true, detail: "7z" },
        { format: "pdf", available: true, detail: "pdftoppm" },
      ];
    case "clear_upscale_cache":
      return { recordsRemoved: 0, filesRemoved: 0 };
    case "list_feature_flags":
      return state.featureFlags;
    case "get_license_state":
      return state.license;
    case "list_telemetry_settings":
      return state.telemetrySettings;
    case "get_ocr_translation_status":
      return state.ocrTranslationStatus;
    case "get_sync_status":
      return state.syncStatus;
    case "get_plugin_status":
      return state.pluginStatus;
    case "get_database_health":
      return { ok: true, message: "ok", backupPath: null };
    case "list_backup_snapshots":
      return [
        {
          id: 1,
          snapshotPath: "D:/MangaVaultFixtures/mangavault.backup-20260712000000.sqlite3",
          reason: "manual",
          byteSize: 4096,
          createdAt: "2026-07-12T00:00:00Z",
        },
      ];
    case "get_database_restore_status":
      return state.databaseRestoreStatus;
    case "schedule_database_restore": {
      const payload = args as { snapshotPath: string };
      state.databaseRestoreStatus = {
        pendingSnapshot: {
          id: 1,
          snapshotPath: payload.snapshotPath,
          reason: "manual",
          byteSize: 4096,
          createdAt: "2026-07-12T00:00:00Z",
        },
      };
      return state.databaseRestoreStatus;
    }
    case "cancel_database_restore":
      state.databaseRestoreStatus = { pendingSnapshot: null };
      return state.databaseRestoreStatus;
    case "check_for_updates": {
      const english = String(state.settings.locale).toLowerCase().startsWith("en");
      return {
        currentVersion: "1.1.0 RC1",
        available: false,
        latestVersion: null,
        notes: english
          ? "Automatic updates are not configured for this offline build."
          : "当前离线版本尚未配置自动更新。",
      };
    }
    case "get_settings":
      return state.settings;
    case "set_setting": {
      const payload = args as { key: string; value: unknown };
      if (payload.key === settingFailureKey) throw new Error("simulated setting write failure");
      state.settings = { ...state.settings, [payload.key]: payload.value };
      if (payload.key === "shortcuts.user_bindings") {
        globalThis.localStorage.setItem(
          "mangavault.e2e.shortcut-bindings",
          JSON.stringify(payload.value),
        );
      }
      if (payload.key === "ui.layout.sidebar_mode") {
        globalThis.localStorage.setItem("mangavault.e2e.sidebar-mode", String(payload.value));
      }
      if (payload.key === "library.open_mouse_action") {
        globalThis.localStorage.setItem("mangavault.e2e.book-open-action", String(payload.value));
      }
      if (payload.key === "reader.launch_state") {
        globalThis.localStorage.setItem(
          "mangavault.e2e.reader-launch-state",
          String(payload.value),
        );
      }
      if (payload.key === "reader.last_stable_state") {
        globalThis.localStorage.setItem(
          "mangavault.e2e.reader-last-stable-state",
          String(payload.value),
        );
      }
      if (payload.key === "ui.settings.section") {
        globalThis.localStorage.setItem("mangavault.e2e.settings-section", String(payload.value));
      }
      if (payload.key === "recent.view") {
        globalThis.localStorage.setItem("mangavault.e2e.recent-view", String(payload.value));
      }
      if (payload.key === "recent.sort") {
        globalThis.localStorage.setItem("mangavault.e2e.recent-sort", String(payload.value));
      }
      if (payload.key === "recent.filter") {
        globalThis.localStorage.setItem("mangavault.e2e.recent-filter", String(payload.value));
      }
      return state.settings;
    }
    case "list_tags":
      return ["e2e", "冒险", "彩色"];
    case "list_categories":
      return ["Manga"];
    case "list_authors":
      return Array.from(
        new Set(
          books.map((book) => book.author).filter((author): author is string => Boolean(author)),
        ),
      ).sort();
    case "list_formats":
      return Array.from(new Set(books.map((book) => book.format))).sort();
    case "list_books":
      return filterBooks(args as Parameters<typeof filterBooks>[0]);
    case "toggle_favorite": {
      const id = (args as { id: number }).id;
      const index = books.findIndex((book) => book.id === id);
      if (index < 0) throw new Error("book not found");
      books[index] = { ...books[index], isFavorite: !books[index].isFavorite };
      return books[index];
    }
    case "set_rating": {
      const payload = args as { id: number; rating: number };
      const index = books.findIndex((book) => book.id === payload.id);
      if (index < 0) throw new Error("book not found");
      books[index] = { ...books[index], rating: payload.rating };
      return books[index];
    }
    case "update_book_metadata": {
      if (metadataFailureMode) throw new Error("simulated metadata write failure");
      const payload = args as {
        id: number;
        update: Pick<Book, "title" | "author" | "volume" | "chapter">;
      };
      const index = books.findIndex((book) => book.id === payload.id);
      if (index < 0) throw new Error("book not found");
      books[index] = {
        ...books[index],
        ...payload.update,
        sortTitle: payload.update.title.toLowerCase(),
      };
      return books[index];
    }
    case "set_book_tags": {
      const payload = args as { bookId: number; tags: string[] };
      const index = books.findIndex((book) => book.id === payload.bookId);
      if (index < 0) throw new Error("book not found");
      books[index] = { ...books[index], tags: payload.tags };
      return payload.tags;
    }
    case "get_book":
      return books.find((book) => book.id === (args as { id: number }).id) ?? null;
    case "get_book_pages":
      return pages;
    case "get_book_chapters":
      return chapters;
    case "get_progress":
      return state.progress;
    case "get_page_data":
      return delayedPagePayload((args as { pageIndex?: number }).pageIndex ?? 0);
    case "get_thumbnail_data":
      return pagePayload((args as { pageIndex?: number }).pageIndex ?? 0);
    case "save_progress": {
      const payload = args as {
        bookId: number;
        currentPage: number;
        totalPages: number;
        mode: string;
        direction: string;
      };
      state.progress = {
        bookId: payload.bookId,
        currentPage: payload.currentPage,
        totalPages: payload.totalPages,
        percent: (payload.currentPage + 1) / payload.totalPages,
        mode: payload.mode,
        direction: payload.direction,
        updatedAt: "2026-07-08T00:00:01Z",
      };
      return state.progress;
    }
    case "record_reading_opened":
      {
        const payload = args as { bookId: number; pageIndex: number };
        const book = books.find((candidate) => candidate.id === payload.bookId);
        if (book) {
          state.history = [
            {
              bookId: book.id,
              title: book.title,
              pageIndex: payload.pageIndex,
              totalPages: book.pageCount,
              openedAt: "2026-07-22T10:00:00Z",
              path: book.path,
            },
            ...state.history.filter((item) => item.bookId !== book.id),
          ];
        }
      }
      return null;
    case "remove_recent_reading": {
      const bookId = (args as { bookId: number }).bookId;
      const before = state.history.length;
      state.history = state.history.filter((item) => item.bookId !== bookId);
      return before - state.history.length;
    }
    case "reset_reading_progress": {
      const bookId = (args as { bookId: number }).bookId;
      if (state.progress?.bookId === bookId) state.progress = null;
      state.history = state.history.map((item) =>
        item.bookId === bookId ? { ...item, pageIndex: 0 } : item,
      );
      return null;
    }
    case "mark_book_read": {
      const bookId = (args as { bookId: number }).bookId;
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw new Error("book not found");
      state.progress = {
        bookId,
        currentPage: Math.max(0, book.pageCount - 1),
        totalPages: book.pageCount,
        percent: 1,
        mode: "single",
        direction: "ltr",
        updatedAt: "2026-07-22T10:00:00Z",
      };
      return state.progress;
    }
    case "clear_reading_history": {
      const removed = state.history.length;
      state.history = [];
      return removed;
    }
    case "backup_database":
      return "D:/MangaVaultFixtures/mangavault.backup.sqlite3";
    case "clear_application_caches":
      return { recordsRemoved: 2, filesRemoved: 2 };
    case "reset_application_settings":
      state.settings = {
        ...state.settings,
        locale: "zh-CN",
        "appearance.theme": "system",
        "ui.layout.sidebar_mode": "expanded",
      };
      return state.settings;
    case "list_bookmarks":
      return state.bookmarks;
    case "add_bookmark": {
      const payload = args as { bookId: number; pageIndex: number; note?: string };
      const bookmark: Bookmark = {
        id: state.bookmarks.length + 1,
        bookId: payload.bookId,
        pageIndex: payload.pageIndex,
        note: payload.note ?? null,
        createdAt: "2026-07-08T00:00:02Z",
      };
      state.bookmarks = [...state.bookmarks, bookmark];
      return bookmark;
    }
    case "remove_bookmark":
      state.bookmarks = state.bookmarks.filter(
        (bookmark) => bookmark.id !== (args as { id: number }).id,
      );
      return null;
    default:
      return null;
  }
});

function filterBooks(args: {
  query?: {
    search?: string;
    author?: string;
    tag?: string;
    category?: string;
    status?: string;
    limit?: number;
    offset?: number;
  };
}): Book[] {
  if (emptyLibraryMode || newUserMode) return [];
  const search = args.query?.search?.trim().toLowerCase();
  const author = args.query?.author?.trim();
  const status = args.query?.status?.trim();
  const tag = args.query?.tag?.trim();
  const category = args.query?.category?.trim();
  const filtered = books.filter((book) => {
    if (author && book.author !== author) return false;
    if (status && book.status !== status) return false;
    if (tag && book.id !== 1 && !book.tags.includes(tag)) return false;
    if (category && !(book.id === 1 && category === "Manga")) return false;
    if (!search) return true;
    const sourceValues =
      book.id === 1 ? ["10001", "JM Source Title", "JM Author", "冒险", "彩色", "Manga"] : [];
    return [book.title, book.author, book.path, ...sourceValues].some((value) =>
      value?.toLowerCase().includes(search),
    );
  });
  const offset = Math.max(0, args.query?.offset ?? 0);
  const limit = Math.max(1, args.query?.limit ?? 500);
  return filtered.slice(offset, offset + limit);
}

function readPersistedShortcutBindings(): Record<string, unknown> {
  try {
    const value = globalThis.localStorage.getItem("mangavault.e2e.shortcut-bindings");
    return value ? (JSON.parse(value) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readPersistedSetting<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = globalThis.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : null;
  } catch {
    return null;
  }
}

function readQuerySetting<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function pagePayload(pageIndex: number): PagePayload {
  return {
    pageIndex,
    mimeType: "image/svg+xml",
    dataUrl: imageDataUrl,
  };
}

async function delayedPagePayload(pageIndex: number): Promise<PagePayload> {
  const delay = readerPageDelays.get(pageIndex) ?? readerPageDelay;
  if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
  if (readerPageFailures.has(pageIndex)) {
    throw new Error(`simulated reader page failure: ${pageIndex}`);
  }
  return pagePayload(pageIndex);
}

function parsePageNumberMap(value: string | null): Map<number, number> {
  const result = new Map<number, number>();
  for (const item of (value ?? "").split(",")) {
    const [page, delay] = item.split(":").map((part) => Number(part.trim()));
    if (Number.isInteger(page) && Number.isFinite(delay) && delay >= 0) {
      result.set(page, delay);
    }
  }
  return result;
}

function parseReaderMode(value: string | null): "single" | "double" | "scroll" {
  return value === "double" || value === "scroll" ? value : "single";
}

function parseReaderControlsLayout(value: string | null): "auto" | "overlay" | "reserved" {
  return value === "overlay" || value === "reserved" ? value : "auto";
}
