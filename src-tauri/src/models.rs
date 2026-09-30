use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: i64,
    pub name: String,
    pub root_path: String,
    pub recursive: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_scan_at: Option<String>,
    pub book_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: i64,
    pub library_id: Option<i64>,
    pub series_id: Option<i64>,
    pub title: String,
    pub sort_title: String,
    pub author: Option<String>,
    pub volume: Option<f64>,
    pub chapter: Option<f64>,
    pub path: String,
    pub format: String,
    pub file_size: i64,
    pub modified_at: Option<String>,
    pub page_count: i64,
    pub cover_page_index: i64,
    pub cover_cache_key: Option<String>,
    pub is_favorite: bool,
    pub rating: i64,
    pub status: String,
    pub imported_at: String,
    pub updated_at: String,
    pub last_read_at: Option<String>,
    pub progress_percent: f64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPage {
    pub id: i64,
    pub book_id: i64,
    pub page_index: i64,
    pub source_path: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub byte_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub chapter_number: Option<f64>,
    pub start_page: i64,
    pub page_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagePayload {
    pub page_index: i64,
    pub mime_type: String,
    pub data_url: String,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub book_id: i64,
    pub current_page: i64,
    pub total_pages: i64,
    pub percent: f64,
    pub mode: String,
    pub direction: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub book_id: i64,
    pub page_index: i64,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanJob {
    pub id: i64,
    pub library_id: Option<i64>,
    pub root_path: String,
    pub status: String,
    pub discovered_count: i64,
    pub imported_count: i64,
    pub failed_count: i64,
    pub message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFailure {
    pub id: i64,
    pub scan_job_id: i64,
    pub path: Option<String>,
    pub stage: String,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingHistoryItem {
    pub book_id: i64,
    pub title: String,
    pub page_index: i64,
    pub total_pages: i64,
    pub opened_at: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentReadingQuery {
    pub search: Option<String>,
    pub filter: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub timezone_offset_minutes: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentReadingItem {
    pub book: Book,
    pub current_page: i64,
    pub total_pages: i64,
    pub progress_percent: f64,
    pub last_read_at: String,
    pub is_finished: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentReadingPage {
    pub items: Vec<RecentReadingItem>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDataSummary {
    pub libraries: i64,
    pub books: i64,
    pub reading_history: i64,
    pub reading_progress: i64,
    pub bookmarks: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseResetSchedule {
    pub backup_path: String,
    pub scheduled_at: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseResetOutcome {
    pub success: bool,
    pub backup_path: Option<String>,
    pub archive_path: Option<String>,
    pub message: String,
    pub reset_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupDataStatus {
    pub app_data_path: String,
    pub had_existing_database: bool,
    pub should_prompt: bool,
    pub summary: LocalDataSummary,
    pub reset_outcome: Option<DatabaseResetOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseHealth {
    pub ok: bool,
    pub message: String,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSnapshot {
    pub id: i64,
    pub snapshot_path: String,
    pub reason: String,
    pub byte_size: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRestoreStatus {
    pub pending_snapshot: Option<BackupSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMaintenanceResult {
    pub vacuum: bool,
    pub page_count_before: i64,
    pub page_count_after: i64,
    pub freelist_count_before: i64,
    pub freelist_count_after: i64,
    pub elapsed_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub available: bool,
    pub latest_version: Option<String>,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderProfileRecord {
    pub id: i64,
    pub profile_id: String,
    pub name: String,
    pub mode: String,
    pub direction: String,
    pub fit: String,
    pub settings: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettingsScopeCounts {
    pub book_settings: i64,
    pub series_settings: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCleanupResult {
    pub records_removed: i64,
    pub files_removed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRemovalPreview {
    pub library_id: i64,
    pub books: i64,
    pub pages: i64,
    pub chapters: i64,
    pub bookmarks: i64,
    pub thumbnail_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRemovalResult {
    pub library_id: i64,
    pub books_removed: i64,
    pub thumbnail_files_removed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedBookCleanupPreview {
    pub books: i64,
    pub pages: i64,
    pub chapters: i64,
    pub thumbnails: i64,
    pub thumbnail_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedBookCleanupResult {
    pub books_removed: i64,
    pub pages_removed: i64,
    pub chapters_removed: i64,
    pub thumbnail_records_removed: i64,
    pub thumbnail_files_removed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCollectionRecord {
    pub id: i64,
    pub name: String,
    pub query: serde_json::Value,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlagRecord {
    pub key: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStateRecord {
    pub status: String,
    pub license_key_present: bool,
    pub metadata: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySettingRecord {
    pub key: String,
    pub enabled: bool,
    pub value: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTranslationStatus {
    pub ocr_enabled: bool,
    pub translation_enabled: bool,
    pub ocr_provider_id: Option<String>,
    pub translation_provider_id: Option<String>,
    pub ocr_locale: String,
    pub source_locale: String,
    pub target_locale: String,
    pub ocr_cache_entries: i64,
    pub translation_cache_entries: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusRecord {
    pub enabled: bool,
    pub provider_id: Option<String>,
    pub automatic_sync: bool,
    pub encryption_required: bool,
    pub conflict_strategy: String,
    pub configured_providers: i64,
    pub log_entries: i64,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatusRecord {
    pub enabled: bool,
    pub manifest_count: i64,
    pub enabled_manifest_count: i64,
    pub settings_count: i64,
    pub dynamic_execution_enabled: bool,
    pub plugin_directory: String,
    pub example_manifest_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub name: String,
    pub path: String,
    pub byte_size: i64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookQuery {
    pub search: Option<String>,
    pub sort: Option<String>,
    pub view: Option<String>,
    pub favorite: Option<bool>,
    pub author: Option<String>,
    pub tag: Option<String>,
    pub category: Option<String>,
    pub format: Option<String>,
    pub status: Option<String>,
    pub min_rating: Option<i64>,
    pub duplicates_only: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalMatchBook {
    pub id: i64,
    pub title: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalBookIdentity {
    pub book_id: i64,
    pub provider_id: String,
    pub remote_id: String,
    pub match_method: String,
    pub match_confidence: f64,
    pub canonical_source_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExternalIdentityCandidate {
    pub book_id: i64,
    pub remote_id: String,
    pub canonical_source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalIdentityImportResult {
    pub linked: i64,
    pub unchanged: i64,
    pub conflicts: i64,
    pub skipped: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChapterMetadata {
    pub remote_id: String,
    pub name: Option<String>,
    pub sort: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalBookMetadata {
    pub book_id: i64,
    pub provider_id: String,
    pub remote_id: String,
    pub original_title: Option<String>,
    pub authors: Vec<String>,
    pub categories: Vec<String>,
    pub tags: Vec<String>,
    pub description: Option<String>,
    pub chapters: Vec<ExternalChapterMetadata>,
    pub remote_cover_url: Option<String>,
    pub fetched_at: String,
    pub expires_at: String,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataFieldDiff {
    pub field_name: String,
    pub current_value: Option<String>,
    pub provider_value: Option<String>,
    pub manually_edited: bool,
    pub default_selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataMergePreview {
    pub book_id: i64,
    pub provider_id: String,
    pub remote_id: String,
    pub fields: Vec<MetadataFieldDiff>,
    pub source_tags: Vec<String>,
    pub cached_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataJobRecord {
    pub id: i64,
    pub provider_id: String,
    pub book_id: i64,
    pub remote_id: String,
    pub status: String,
    pub requested_by: String,
    pub attempts: i64,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JmComicProviderStatus {
    pub enabled: bool,
    pub endpoint: String,
    pub refresh_days: i64,
    pub request_interval_ms: i64,
    pub linked_books: i64,
    pub cached_books: i64,
    pub queued_jobs: i64,
    pub running_jobs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JmComicBookSource {
    pub identity: ExternalBookIdentity,
    pub metadata: Option<ExternalBookMetadata>,
    pub merge_preview: Option<MetadataMergePreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataBatchPreview {
    pub preview_token: String,
    pub total_linked: i64,
    pub eligible: i64,
    pub fresh_cached: i64,
    pub generated_at: String,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataBatchResult {
    pub requested: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataUpdate {
    pub title: String,
    pub author: Option<String>,
    pub volume: Option<f64>,
    pub chapter: Option<f64>,
}
