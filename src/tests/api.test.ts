import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

import {
  clearApplicationCaches,
  clearReadingHistory,
  getFormatCapabilities,
  getLibraryRemovalPreview,
  removeLibrary,
  resetApplicationSettings,
  resolvePagePayload,
  getStartupDataStatus,
  acknowledgeExistingData,
  scheduleDatabaseReset,
  restartApplication,
  listRecentReading,
  removeRecentReading,
  resetReadingProgress,
  markBookRead,
  chooseJmComicDatabase,
  discoverJmComicSources,
  previewJmComicMatches,
  importJmComicIdentities,
  getJmComicProviderStatus,
  getJmComicMetadata,
  refreshJmComicMetadata,
  listJmComicMetadataJobs,
  getJmComicBookSource,
  listCategories,
  previewJmComicMetadataBatch,
  runJmComicMetadataBatch,
  cancelJmComicMetadataBatch,
} from "../lib/api";

describe("page payload transport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts cache file payloads to asset URLs", () => {
    const payload = resolvePagePayload({
      pageIndex: 3,
      mimeType: "image/webp",
      dataUrl: "",
      filePath: "D:/Cache/reader-pages/page.webp",
    });

    expect(core.convertFileSrc).toHaveBeenCalledWith("D:/Cache/reader-pages/page.webp");
    expect(payload.dataUrl).toContain("asset://localhost/");
  });

  it("keeps inline payloads used by browser tests and fallbacks", () => {
    const payload = { pageIndex: 0, mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" };

    expect(resolvePagePayload(payload)).toBe(payload);
    expect(core.convertFileSrc).not.toHaveBeenCalled();
  });

  it("uses dedicated native commands for safe library and local-data actions", async () => {
    core.invoke.mockResolvedValue({});

    await getLibraryRemovalPreview(12);
    await removeLibrary(12);
    await clearApplicationCaches();
    await clearReadingHistory();
    await resetApplicationSettings();
    await getStartupDataStatus();
    await acknowledgeExistingData();
    await scheduleDatabaseReset();
    await restartApplication();

    expect(core.invoke).toHaveBeenNthCalledWith(1, "get_library_removal_preview", {
      libraryId: 12,
    });
    expect(core.invoke).toHaveBeenNthCalledWith(2, "remove_library", { libraryId: 12 });
    expect(core.invoke).toHaveBeenNthCalledWith(3, "clear_application_caches");
    expect(core.invoke).toHaveBeenNthCalledWith(4, "clear_reading_history");
    expect(core.invoke).toHaveBeenNthCalledWith(5, "reset_application_settings");
    expect(core.invoke).toHaveBeenNthCalledWith(6, "get_startup_data_status");
    expect(core.invoke).toHaveBeenNthCalledWith(7, "acknowledge_existing_data");
    expect(core.invoke).toHaveBeenNthCalledWith(8, "schedule_database_reset");
    expect(core.invoke).toHaveBeenNthCalledWith(9, "restart_application");
  });

  it("shares one in-flight format capability request and caches it for the session", async () => {
    let resolveRequest: (
      value: Array<{ format: string; available: boolean; detail: string }>,
    ) => void = () => undefined;
    core.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = getFormatCapabilities();
    const second = getFormatCapabilities();
    expect(first).toBe(second);
    expect(core.invoke).toHaveBeenCalledTimes(1);

    const capabilities = [{ format: "pdf", available: true, detail: "pdftoppm.exe" }];
    resolveRequest(capabilities);
    await expect(first).resolves.toEqual(capabilities);
    await expect(getFormatCapabilities()).resolves.toEqual(capabilities);
    expect(core.invoke).toHaveBeenCalledTimes(1);
  });

  it("uses explicit recent-reading commands without conflating history and progress", async () => {
    core.invoke.mockResolvedValue({});

    await listRecentReading({ filter: "unfinished", limit: 80, offset: 0 });
    await removeRecentReading(7);
    await resetReadingProgress(7);
    await markBookRead(7);

    expect(core.invoke).toHaveBeenNthCalledWith(1, "list_recent_reading", {
      query: { filter: "unfinished", limit: 80, offset: 0 },
    });
    expect(core.invoke).toHaveBeenNthCalledWith(2, "remove_recent_reading", { bookId: 7 });
    expect(core.invoke).toHaveBeenNthCalledWith(3, "reset_reading_progress", { bookId: 7 });
    expect(core.invoke).toHaveBeenNthCalledWith(4, "mark_book_read", { bookId: 7 });
  });

  it("uses explicit JMComic identity and metadata commands", async () => {
    core.invoke.mockResolvedValue({});

    await chooseJmComicDatabase();
    await discoverJmComicSources();
    await previewJmComicMatches("D:/JMComic/data/download.db");
    await importJmComicIdentities("D:/JMComic/data/download.db", "preview-token");
    await getJmComicProviderStatus();
    await getJmComicMetadata(7);
    await refreshJmComicMetadata(7, true);
    await listJmComicMetadataJobs(10);
    await getJmComicBookSource(7);
    await listCategories();
    await previewJmComicMetadataBatch(false);
    await runJmComicMetadataBatch("batch-token", false);
    await cancelJmComicMetadataBatch();

    expect(core.invoke).toHaveBeenNthCalledWith(1, "choose_jmcomic_database");
    expect(core.invoke).toHaveBeenNthCalledWith(2, "discover_jmcomic_sources");
    expect(core.invoke).toHaveBeenNthCalledWith(3, "preview_jmcomic_matches", {
      databasePath: "D:/JMComic/data/download.db",
    });
    expect(core.invoke).toHaveBeenNthCalledWith(4, "import_jmcomic_identities", {
      databasePath: "D:/JMComic/data/download.db",
      previewToken: "preview-token",
    });
    expect(core.invoke).toHaveBeenNthCalledWith(5, "get_jmcomic_provider_status");
    expect(core.invoke).toHaveBeenNthCalledWith(6, "get_jmcomic_metadata", { bookId: 7 });
    expect(core.invoke).toHaveBeenNthCalledWith(7, "refresh_jmcomic_metadata", {
      bookId: 7,
      force: true,
    });
    expect(core.invoke).toHaveBeenNthCalledWith(8, "list_jmcomic_metadata_jobs", { limit: 10 });
    expect(core.invoke).toHaveBeenNthCalledWith(9, "get_jmcomic_book_source", { bookId: 7 });
    expect(core.invoke).toHaveBeenNthCalledWith(10, "list_categories");
    expect(core.invoke).toHaveBeenNthCalledWith(11, "preview_jmcomic_metadata_batch", {
      force: false,
    });
    expect(core.invoke).toHaveBeenNthCalledWith(12, "run_jmcomic_metadata_batch", {
      previewToken: "batch-token",
      force: false,
    });
    expect(core.invoke).toHaveBeenNthCalledWith(13, "cancel_jmcomic_metadata_batch");
  });
});
