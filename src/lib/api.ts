import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  Book,
  BookPage,
  BookQuery,
  Bookmark,
  Chapter,
  Library,
  LibraryRemovalPreview,
  LibraryRemovalResult,
  PagePayload,
  ReadingProgress,
  ScanFailure,
  ScanJob,
  MetadataUpdate,
  ReadingHistoryItem,
  RecentReadingPage,
  RecentReadingQuery,
  BackupSnapshot,
  DatabaseHealth,
  DatabaseRestoreStatus,
  DatabaseMaintenanceResult,
  DeletedBookCleanupPreview,
  DeletedBookCleanupResult,
  UpdateStatus,
  LogFileInfo,
  ReaderProfileRecord,
  ReaderSettingsScopeCounts,
  SmartCollectionRecord,
  CacheCleanupResult,
  FeatureFlagRecord,
  LicenseStateRecord,
  OcrTranslationStatus,
  PluginStatusRecord,
  SyncStatusRecord,
  TelemetrySettingRecord,
  FormatCapability,
  StartupDataStatus,
  DatabaseResetSchedule,
  JmComicMatchPreview,
  ExternalIdentityImportResult,
  JmComicProviderStatus,
  JmComicBookSource,
  MetadataJobRecord,
  MetadataMergePreview,
  MetadataBatchPreview,
  MetadataBatchResult,
  JmComicSourceCandidate,
} from "./types";

export async function chooseImportFolder(): Promise<string | null> {
  return invoke<string | null>("choose_import_folder");
}

export async function chooseImportFiles(): Promise<string[] | null> {
  return invoke<string[] | null>("choose_import_files");
}

export async function chooseJmComicDatabase(): Promise<string | null> {
  return invoke<string | null>("choose_jmcomic_database");
}

export async function discoverJmComicSources(): Promise<JmComicSourceCandidate[]> {
  return invoke<JmComicSourceCandidate[]>("discover_jmcomic_sources");
}

export async function previewJmComicMatches(databasePath: string): Promise<JmComicMatchPreview> {
  return invoke<JmComicMatchPreview>("preview_jmcomic_matches", { databasePath });
}

export async function importJmComicIdentities(
  databasePath: string,
  previewToken: string,
): Promise<ExternalIdentityImportResult> {
  return invoke<ExternalIdentityImportResult>("import_jmcomic_identities", {
    databasePath,
    previewToken,
  });
}

export async function getJmComicProviderStatus(): Promise<JmComicProviderStatus> {
  return invoke<JmComicProviderStatus>("get_jmcomic_provider_status");
}

export async function getJmComicMetadata(bookId: number): Promise<MetadataMergePreview | null> {
  return invoke<MetadataMergePreview | null>("get_jmcomic_metadata", { bookId });
}

export async function getJmComicBookSource(bookId: number): Promise<JmComicBookSource | null> {
  return invoke<JmComicBookSource | null>("get_jmcomic_book_source", { bookId });
}

export async function refreshJmComicMetadata(
  bookId: number,
  force = false,
): Promise<MetadataMergePreview> {
  return invoke<MetadataMergePreview>("refresh_jmcomic_metadata", { bookId, force });
}

export async function listJmComicMetadataJobs(limit = 20): Promise<MetadataJobRecord[]> {
  return invoke<MetadataJobRecord[]>("list_jmcomic_metadata_jobs", { limit });
}

export async function previewJmComicMetadataBatch(force = false): Promise<MetadataBatchPreview> {
  return invoke<MetadataBatchPreview>("preview_jmcomic_metadata_batch", { force });
}

export async function runJmComicMetadataBatch(
  previewToken: string,
  force = false,
): Promise<MetadataBatchResult> {
  return invoke<MetadataBatchResult>("run_jmcomic_metadata_batch", { previewToken, force });
}

export async function cancelJmComicMetadataBatch(): Promise<void> {
  return invoke<void>("cancel_jmcomic_metadata_batch");
}

export async function importFolder(rootPath: string, recursive = true) {
  return invoke<{ jobId: number; discovered: number; imported: number; failed: number }>(
    "import_folder",
    { rootPath, recursive },
  );
}

export interface ImportJobResult {
  jobId: number;
  status: string;
}

export async function importPaths(paths: string[], recursive = true): Promise<ImportJobResult[]> {
  return invoke<ImportJobResult[]>("import_paths", { paths, recursive });
}

export async function takeLaunchPaths(): Promise<string[]> {
  return invoke<string[]>("take_launch_paths");
}

export async function rescanLibrary(rootPath: string, recursive = true) {
  return invoke<{ jobId: number; status: string }>("rescan_library", { rootPath, recursive });
}

export async function listLibraries(): Promise<Library[]> {
  return invoke<Library[]>("list_libraries");
}

export async function getLibraryRemovalPreview(libraryId: number): Promise<LibraryRemovalPreview> {
  return invoke<LibraryRemovalPreview>("get_library_removal_preview", { libraryId });
}

export async function removeLibrary(libraryId: number): Promise<LibraryRemovalResult> {
  return invoke<LibraryRemovalResult>("remove_library", { libraryId });
}

export async function purgeMissingBooks(libraryId?: number): Promise<{ removed: number }> {
  return invoke<{ removed: number }>("purge_missing_books", { libraryId });
}

export async function getDeletedBookCleanupPreview(): Promise<DeletedBookCleanupPreview> {
  return invoke<DeletedBookCleanupPreview>("get_deleted_book_cleanup_preview");
}

export async function purgeDeletedBooks(): Promise<DeletedBookCleanupResult> {
  return invoke<DeletedBookCleanupResult>("purge_deleted_books");
}

export async function listBooks(query: BookQuery): Promise<Book[]> {
  return invoke<Book[]>("list_books", { query });
}

export async function listFormats(): Promise<string[]> {
  return invoke<string[]>("list_formats");
}

let formatCapabilitiesCache: FormatCapability[] | undefined;
let formatCapabilitiesInFlight: Promise<FormatCapability[]> | undefined;

export function getFormatCapabilities(): Promise<FormatCapability[]> {
  if (formatCapabilitiesCache) return Promise.resolve(formatCapabilitiesCache);
  if (formatCapabilitiesInFlight) return formatCapabilitiesInFlight;

  const request = invoke<FormatCapability[]>("get_format_capabilities")
    .then((capabilities) => {
      formatCapabilitiesCache = capabilities;
      return capabilities;
    })
    .finally(() => {
      if (formatCapabilitiesInFlight === request) formatCapabilitiesInFlight = undefined;
    });
  formatCapabilitiesInFlight = request;
  return request;
}

export async function getBook(id: number): Promise<Book> {
  return invoke<Book>("get_book", { id });
}

export async function getBookByPath(path: string): Promise<Book | null> {
  return invoke<Book | null>("get_book_by_path", { path });
}

export async function updateBookMetadata(id: number, update: MetadataUpdate): Promise<Book> {
  return invoke<Book>("update_book_metadata", { id, update });
}

export async function getBookPages(bookId: number): Promise<BookPage[]> {
  return invoke<BookPage[]>("get_book_pages", { bookId });
}

export async function getBookChapters(bookId: number): Promise<Chapter[]> {
  return invoke<Chapter[]>("get_book_chapters", { bookId });
}

export async function getPageData(
  bookId: number,
  pageIndex: number,
  transforms: { trimWhite: boolean; sharpen: boolean },
): Promise<PagePayload> {
  return resolvePagePayload(
    await invoke<PagePayload>("get_page_data", { bookId, pageIndex, ...transforms }),
  );
}

export async function getThumbnailData(bookId: number, pageIndex: number): Promise<PagePayload> {
  return resolvePagePayload(await invoke<PagePayload>("get_thumbnail_data", { bookId, pageIndex }));
}

export function resolvePagePayload(payload: PagePayload): PagePayload {
  if (!payload.filePath) return payload;
  return { ...payload, dataUrl: convertFileSrc(payload.filePath) };
}

export async function saveProgress(
  bookId: number,
  currentPage: number,
  totalPages: number,
  mode: string,
  direction: string,
) {
  return invoke("save_progress", { bookId, currentPage, totalPages, mode, direction });
}

export async function recordReadingOpened(bookId: number, pageIndex: number): Promise<void> {
  return invoke("record_reading_opened", { bookId, pageIndex });
}

export async function getProgress(bookId: number): Promise<ReadingProgress | null> {
  return invoke<ReadingProgress | null>("get_progress", { bookId });
}

export async function addBookmark(bookId: number, pageIndex: number, note?: string) {
  return invoke<Bookmark>("add_bookmark", { bookId, pageIndex, note });
}

export async function removeBookmark(id: number) {
  return invoke("remove_bookmark", { id });
}

export async function listBookmarks(bookId: number): Promise<Bookmark[]> {
  return invoke<Bookmark[]>("list_bookmarks", { bookId });
}

export async function toggleFavorite(id: number): Promise<Book> {
  return invoke<Book>("toggle_favorite", { id });
}

export async function setRating(id: number, rating: number): Promise<Book> {
  return invoke<Book>("set_rating", { id, rating });
}

export async function listTags(): Promise<string[]> {
  return invoke<string[]>("list_tags");
}

export async function listCategories(): Promise<string[]> {
  return invoke<string[]>("list_categories");
}

export async function listAuthors(): Promise<string[]> {
  return invoke<string[]>("list_authors");
}

export async function setBookTags(bookId: number, tags: string[]): Promise<string[]> {
  return invoke<string[]>("set_book_tags", { bookId, tags });
}

export async function listScanJobs(): Promise<ScanJob[]> {
  return invoke<ScanJob[]>("list_scan_jobs");
}

export async function listScanFailures(jobId: number): Promise<ScanFailure[]> {
  return invoke<ScanFailure[]>("list_scan_failures", { jobId });
}

export async function cancelScan(jobId: number): Promise<void> {
  return invoke("cancel_scan", { jobId });
}

export async function retryScan(jobId: number): Promise<ImportJobResult> {
  return invoke<ImportJobResult>("retry_scan", { jobId });
}

export async function getSettings(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("get_settings");
}

export async function setSetting(key: string, value: unknown): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("set_setting", { key, value });
}

export async function getStartupDataStatus(): Promise<StartupDataStatus> {
  return invoke<StartupDataStatus>("get_startup_data_status");
}

export async function acknowledgeExistingData(): Promise<void> {
  return invoke("acknowledge_existing_data");
}

export async function scheduleDatabaseReset(): Promise<DatabaseResetSchedule> {
  return invoke<DatabaseResetSchedule>("schedule_database_reset");
}

export async function restartApplication(): Promise<void> {
  return invoke("restart_application");
}

export async function listHistory(): Promise<ReadingHistoryItem[]> {
  return invoke<ReadingHistoryItem[]>("list_history");
}

export async function listRecentReading(query: RecentReadingQuery): Promise<RecentReadingPage> {
  return invoke<RecentReadingPage>("list_recent_reading", { query });
}

export async function removeRecentReading(bookId: number): Promise<number> {
  return invoke<number>("remove_recent_reading", { bookId });
}

export async function resetReadingProgress(bookId: number): Promise<void> {
  return invoke("reset_reading_progress", { bookId });
}

export async function markBookRead(bookId: number): Promise<ReadingProgress> {
  return invoke<ReadingProgress>("mark_book_read", { bookId });
}

export async function clearReadingHistory(): Promise<number> {
  return invoke<number>("clear_reading_history");
}

export async function listReaderProfiles(): Promise<ReaderProfileRecord[]> {
  return invoke<ReaderProfileRecord[]>("list_reader_profiles");
}

export async function readerSettingsScopeCounts(): Promise<ReaderSettingsScopeCounts> {
  return invoke<ReaderSettingsScopeCounts>("reader_settings_scope_counts");
}

export async function listSmartCollections(): Promise<SmartCollectionRecord[]> {
  return invoke<SmartCollectionRecord[]>("list_smart_collections");
}

export async function getDatabaseHealth(): Promise<DatabaseHealth> {
  return invoke<DatabaseHealth>("get_database_health");
}

export async function backupDatabase(): Promise<string> {
  return invoke<string>("backup_database");
}

export async function listBackupSnapshots(): Promise<BackupSnapshot[]> {
  return invoke<BackupSnapshot[]>("list_backup_snapshots");
}

export async function getDatabaseRestoreStatus(): Promise<DatabaseRestoreStatus> {
  return invoke<DatabaseRestoreStatus>("get_database_restore_status");
}

export async function scheduleDatabaseRestore(
  snapshotPath: string,
): Promise<DatabaseRestoreStatus> {
  return invoke<DatabaseRestoreStatus>("schedule_database_restore", { snapshotPath });
}

export async function cancelDatabaseRestore(): Promise<DatabaseRestoreStatus> {
  return invoke<DatabaseRestoreStatus>("cancel_database_restore");
}

export async function optimizeDatabase(vacuum: boolean): Promise<DatabaseMaintenanceResult> {
  return invoke<DatabaseMaintenanceResult>("optimize_database", { vacuum });
}

export async function listLogFiles(): Promise<LogFileInfo[]> {
  return invoke<LogFileInfo[]>("list_log_files");
}

export async function openLogDir(): Promise<void> {
  return invoke("open_log_dir");
}

export async function clearApplicationCaches(): Promise<CacheCleanupResult> {
  return invoke<CacheCleanupResult>("clear_application_caches");
}

export async function resetApplicationSettings(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("reset_application_settings");
}

export async function reportFrontendError(message: string, componentStack: string): Promise<void> {
  return invoke("report_frontend_error", { message, componentStack });
}

export async function clearUpscaleCache(): Promise<CacheCleanupResult> {
  return invoke<CacheCleanupResult>("clear_upscale_cache");
}

export async function listFeatureFlags(): Promise<FeatureFlagRecord[]> {
  return invoke<FeatureFlagRecord[]>("list_feature_flags");
}

export async function getLicenseState(): Promise<LicenseStateRecord> {
  return invoke<LicenseStateRecord>("get_license_state");
}

export async function listTelemetrySettings(): Promise<TelemetrySettingRecord[]> {
  return invoke<TelemetrySettingRecord[]>("list_telemetry_settings");
}

export async function getOcrTranslationStatus(): Promise<OcrTranslationStatus> {
  return invoke<OcrTranslationStatus>("get_ocr_translation_status");
}

export async function getSyncStatus(): Promise<SyncStatusRecord> {
  return invoke<SyncStatusRecord>("get_sync_status");
}

export async function getPluginStatus(): Promise<PluginStatusRecord> {
  return invoke<PluginStatusRecord>("get_plugin_status");
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("check_for_updates");
}

export async function openPathInShell(path: string): Promise<void> {
  return invoke("open_path_in_shell", { path });
}
