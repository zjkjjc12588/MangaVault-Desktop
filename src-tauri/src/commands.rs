use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Instant;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::db::{Database, ThumbnailRecord};
use crate::error::{MangaVaultError, Result};
use crate::models::{
    BackupSnapshot, Book, BookPage, BookQuery, Bookmark, CacheCleanupResult, Chapter,
    DatabaseHealth, DatabaseMaintenanceResult, DatabaseResetSchedule, DatabaseRestoreStatus,
    DeletedBookCleanupPreview, DeletedBookCleanupResult, ExternalIdentityCandidate,
    ExternalIdentityImportResult, FeatureFlagRecord, JmComicBookSource, JmComicProviderStatus,
    Library, LibraryRemovalPreview, LibraryRemovalResult, LicenseStateRecord, LogFileInfo,
    MetadataBatchPreview, MetadataBatchResult, MetadataJobRecord, MetadataMergePreview,
    MetadataUpdate, OcrTranslationStatus, PagePayload, PluginStatusRecord, ReaderProfileRecord,
    ReaderSettingsScopeCounts, ReadingHistoryItem, ScanFailure, ScanJob, SmartCollectionRecord,
    StartupDataStatus, SyncStatusRecord, TelemetrySettingRecord, UpdateStatus,
};
use crate::scan_queue::ScanRequest;
use crate::{archive, cache, jmcomic, jmcomic_metadata, logs, reader, services, AppState};

const DISPLAY_VERSION: &str = "1.1.0 RC1";

#[tauri::command]
pub fn get_app_info(_app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "MangaVault Desktop",
        "version": DISPLAY_VERSION,
        "offline": true
    })
}

#[tauri::command]
pub fn check_for_updates(_app: AppHandle, state: State<'_, AppState>) -> Result<UpdateStatus> {
    let locale = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?
        .locale()?;
    Ok(UpdateStatus {
        current_version: DISPLAY_VERSION.to_string(),
        available: false,
        latest_version: None,
        notes: crate::native_labels(&locale)
            .update_not_configured
            .to_string(),
    })
}

#[tauri::command]
pub fn choose_import_folder(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>> {
    let locale = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?
        .locale()?;
    let picked = app
        .dialog()
        .file()
        .set_title(crate::native_labels(&locale).choose_folder)
        .blocking_pick_folder();
    Ok(picked.map(|path| path.to_string()))
}

#[tauri::command]
pub fn choose_import_files(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Vec<String>>> {
    let locale = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?
        .locale()?;
    let picked = app
        .dialog()
        .file()
        .set_title(crate::native_labels(&locale).choose_files)
        .add_filter(
            crate::native_labels(&locale).comic_files,
            &["cbz", "zip", "cbr", "rar", "7z", "pdf"],
        )
        .blocking_pick_files();
    Ok(picked.map(|paths| paths.into_iter().map(|path| path.to_string()).collect()))
}

#[tauri::command]
pub fn choose_jmcomic_database(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Select JMComic download.db")
        .add_filter("JMComic download database", &["db"])
        .blocking_pick_file()
        .map(|path| path.to_string())
}

#[tauri::command]
pub async fn discover_jmcomic_sources(
    state: State<'_, AppState>,
) -> Result<Vec<jmcomic::JmComicSourceCandidate>> {
    let library_roots = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.list_libraries()?
            .into_iter()
            .map(|library| PathBuf::from(library.root_path))
            .collect::<Vec<_>>()
    };
    let discovery = state.jmcomic_discovery.clone();
    let candidates = discovery
        .get_or_try_init(|| async move {
            tauri::async_runtime::spawn_blocking(move || {
                let roots = jmcomic::default_discovery_roots(&library_roots);
                jmcomic::discover_sources(&roots, &library_roots)
            })
            .await
            .map_err(|error| MangaVaultError::Message(error.to_string()))
        })
        .await?;
    Ok(candidates.clone())
}

#[tauri::command]
pub async fn preview_jmcomic_matches(
    state: State<'_, AppState>,
    database_path: String,
) -> Result<jmcomic::JmComicMatchPreview> {
    let books = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.books_for_external_matching()?
    };
    let path = PathBuf::from(database_path);
    tauri::async_runtime::spawn_blocking(move || jmcomic::preview_matches(&path, &books))
        .await
        .map_err(|error| MangaVaultError::Message(error.to_string()))?
}

#[tauri::command]
pub async fn import_jmcomic_identities(
    state: State<'_, AppState>,
    database_path: String,
    preview_token: String,
) -> Result<ExternalIdentityImportResult> {
    let configured_path = PathBuf::from(&database_path);
    let books = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.books_for_external_matching()?
    };
    let path = PathBuf::from(database_path);
    let preview =
        tauri::async_runtime::spawn_blocking(move || jmcomic::preview_matches(&path, &books))
            .await
            .map_err(|error| MangaVaultError::Message(error.to_string()))??;
    validate_jmcomic_preview_token(&preview.preview_token, &preview_token)?;
    let candidates = preview
        .items
        .iter()
        .filter_map(|item| {
            if item.status != "matched" {
                return None;
            }
            Some(ExternalIdentityCandidate {
                book_id: item.book_id?,
                remote_id: item.jm_id.clone(),
                canonical_source_path: item.logical_root_path.clone(),
            })
        })
        .collect::<Vec<_>>();
    let mut db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    let result = db.import_external_identities("jmcomic", &candidates)?;
    jmcomic_metadata::configure_local_bridge(&db, &configured_path)?;
    Ok(result)
}

#[tauri::command]
pub fn get_jmcomic_provider_status(state: State<'_, AppState>) -> Result<JmComicProviderStatus> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    let provider = jmcomic_metadata::settings(&db)?;
    let (linked_books, cached_books, queued_jobs, running_jobs) =
        db.metadata_provider_counts("jmcomic")?;
    Ok(JmComicProviderStatus {
        enabled: provider.enabled,
        endpoint: provider.endpoint,
        refresh_days: provider.refresh_days,
        request_interval_ms: provider.request_interval_ms,
        linked_books,
        cached_books,
        queued_jobs,
        running_jobs,
    })
}

#[tauri::command]
pub fn get_jmcomic_metadata(
    state: State<'_, AppState>,
    book_id: i64,
) -> Result<Option<MetadataMergePreview>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.metadata_merge_preview(book_id, "jmcomic")
}

#[tauri::command]
pub fn get_jmcomic_book_source(
    state: State<'_, AppState>,
    book_id: i64,
) -> Result<Option<JmComicBookSource>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.jmcomic_book_source(book_id)
}

#[tauri::command]
pub fn list_jmcomic_metadata_jobs(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<MetadataJobRecord>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.recent_metadata_jobs("jmcomic", limit.unwrap_or(20))
}

#[tauri::command]
pub fn preview_jmcomic_metadata_batch(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<MetadataBatchPreview> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    if !jmcomic_metadata::settings(&db)?.enabled {
        return Err(MangaVaultError::Message(
            "JMComic online metadata is disabled; enable it before previewing a batch".to_string(),
        ));
    }
    Ok(jmcomic_metadata::batch_preview(&db, force.unwrap_or(false))?.0)
}

#[tauri::command]
pub async fn run_jmcomic_metadata_batch(
    state: State<'_, AppState>,
    preview_token: String,
    force: Option<bool>,
) -> Result<MetadataBatchResult> {
    let (database_path, eligible) = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        let (preview, eligible) = jmcomic_metadata::batch_preview(&db, force.unwrap_or(false))?;
        validate_jmcomic_preview_token(&preview.preview_token, &preview_token)?;
        if eligible.len() > 10_000 {
            return Err(MangaVaultError::Message(
                "JMComic metadata batch exceeds the 10000-book safety limit".to_string(),
            ));
        }
        (db.path().to_path_buf(), eligible)
    };
    if state
        .metadata_batch_running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(MangaVaultError::Message(
            "a JMComic metadata batch is already running".to_string(),
        ));
    }
    state
        .metadata_batch_cancelled
        .store(false, Ordering::Release);
    let mut result = MetadataBatchResult {
        requested: eligible.len() as i64,
        succeeded: 0,
        failed: 0,
        cancelled: false,
    };
    for book_id in eligible {
        if state.metadata_batch_cancelled.load(Ordering::Acquire) {
            result.cancelled = true;
            break;
        }
        match jmcomic_metadata::refresh_book(
            database_path.clone(),
            state.jmcomic_provider.clone(),
            book_id,
            force.unwrap_or(false),
            "batch",
        )
        .await
        {
            Ok(_) => result.succeeded += 1,
            Err(_) => result.failed += 1,
        }
    }
    state.metadata_batch_running.store(false, Ordering::Release);
    Ok(result)
}

#[tauri::command]
pub fn cancel_jmcomic_metadata_batch(state: State<'_, AppState>) {
    state
        .metadata_batch_cancelled
        .store(true, Ordering::Release);
}

#[tauri::command]
pub async fn refresh_jmcomic_metadata(
    state: State<'_, AppState>,
    book_id: i64,
    force: Option<bool>,
) -> Result<MetadataMergePreview> {
    let database_path = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?
        .path()
        .to_path_buf();
    jmcomic_metadata::refresh_book(
        database_path,
        state.jmcomic_provider.clone(),
        book_id,
        force.unwrap_or(false),
        "user",
    )
    .await
}

fn validate_jmcomic_preview_token(current: &str, supplied: &str) -> Result<()> {
    if current == supplied && !current.is_empty() {
        return Ok(());
    }
    Err(MangaVaultError::Message(
        "JMComic match preview is stale; generate a new preview before importing identities"
            .to_string(),
    ))
}

#[tauri::command]
pub fn import_folder(
    state: State<'_, AppState>,
    root_path: String,
    recursive: bool,
) -> Result<serde_json::Value> {
    let root = canonical_root(root_path)?;
    start_import_scan(&state, root, recursive)
}

#[tauri::command]
pub fn import_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<Vec<serde_json::Value>> {
    let mut groups: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();
    for path in paths {
        let root = canonical_root(path)?;
        let library_root = library_root_for(&root)?;
        groups.entry(library_root).or_default().push(root);
    }

    groups
        .into_iter()
        .map(|(library_root, roots)| {
            start_import_batch_scan(&state, library_root, roots, recursive)
        })
        .collect()
}

#[tauri::command]
pub fn take_launch_paths(state: State<'_, AppState>) -> Result<Vec<String>> {
    let mut paths = state
        .launch_paths
        .lock()
        .map_err(|_| MangaVaultError::Message("launch path lock poisoned".to_string()))?;
    Ok(std::mem::take(&mut *paths)
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

fn start_import_scan(
    state: &State<'_, AppState>,
    root: PathBuf,
    recursive: bool,
) -> Result<serde_json::Value> {
    let library_root = library_root_for(&root)?;
    let (library_id, job_id) = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        let library = db.upsert_library(&library_root, recursive)?;
        let job_id = db.create_scan_job(Some(library.id), &root)?;
        (library.id, job_id)
    };
    state.scan_scheduler.enqueue(ScanRequest {
        library_id,
        job_id,
        roots: vec![root],
        options: services::ScanOptions {
            recursive,
            mark_missing: true,
        },
    })?;
    Ok(serde_json::json!({
        "jobId": job_id,
        "status": "queued"
    }))
}

fn start_import_batch_scan(
    state: &State<'_, AppState>,
    library_root: PathBuf,
    roots: Vec<PathBuf>,
    recursive: bool,
) -> Result<serde_json::Value> {
    let (library_id, job_id) = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        let library = db.upsert_library(&library_root, recursive)?;
        let job_id = db.create_scan_job(Some(library.id), &library_root)?;
        (library.id, job_id)
    };
    state.scan_scheduler.enqueue(ScanRequest {
        library_id,
        job_id,
        roots,
        options: services::ScanOptions {
            recursive,
            mark_missing: false,
        },
    })?;
    Ok(serde_json::json!({
        "jobId": job_id,
        "status": "queued"
    }))
}

#[tauri::command]
pub fn rescan_library(
    state: State<'_, AppState>,
    root_path: String,
    recursive: bool,
) -> Result<serde_json::Value> {
    import_folder(state, root_path, recursive)
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>, job_id: i64) -> Result<()> {
    state
        .cancelled_scans
        .lock()
        .map_err(|_| MangaVaultError::Message("cancel set lock poisoned".to_string()))?
        .insert(job_id);
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.mark_scan_cancel_requested(job_id)?;
    Ok(())
}

#[tauri::command]
pub fn retry_scan(state: State<'_, AppState>, job_id: i64) -> Result<serde_json::Value> {
    let (root, recursive) = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.retry_scan_target(job_id)?
    };
    start_import_scan(
        &state,
        canonical_root(root.to_string_lossy().to_string())?,
        recursive,
    )
}

#[tauri::command]
pub fn list_scan_jobs(state: State<'_, AppState>) -> Result<Vec<ScanJob>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_scan_jobs()
}

#[tauri::command]
pub fn list_scan_failures(state: State<'_, AppState>, job_id: i64) -> Result<Vec<ScanFailure>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_scan_failures(job_id)
}

#[tauri::command]
pub fn get_format_capabilities() -> Vec<archive::FormatCapability> {
    archive::format_capabilities()
}

#[tauri::command]
pub fn list_libraries(state: State<'_, AppState>) -> Result<Vec<Library>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_libraries()
}

#[tauri::command]
pub fn get_library_removal_preview(
    state: State<'_, AppState>,
    library_id: i64,
) -> Result<LibraryRemovalPreview> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.library_removal_preview(library_id)
}

#[tauri::command]
pub fn remove_library(
    app: AppHandle,
    state: State<'_, AppState>,
    library_id: i64,
) -> Result<LibraryRemovalResult> {
    let thumbnail_root = app
        .path()
        .app_cache_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?
        .join("thumbnails");
    let paths = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.library_thumbnail_paths(library_id)?
    };
    let thumbnail_files_removed = cache::remove_cache_files(&thumbnail_root, &paths)? as i64;
    let mut db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    let mut result = db.remove_library(library_id)?;
    result.thumbnail_files_removed = thumbnail_files_removed;
    Ok(result)
}

#[tauri::command]
pub fn purge_missing_books(
    state: State<'_, AppState>,
    library_id: Option<i64>,
) -> Result<serde_json::Value> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    let removed = db.purge_missing_books(library_id)? as i64;
    Ok(serde_json::json!({ "removed": removed }))
}

#[tauri::command]
pub fn get_deleted_book_cleanup_preview(
    state: State<'_, AppState>,
) -> Result<DeletedBookCleanupPreview> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.deleted_book_cleanup_preview()
}

#[tauri::command]
pub fn purge_deleted_books(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DeletedBookCleanupResult> {
    let thumbnail_root = app
        .path()
        .app_cache_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?
        .join("thumbnails");
    let paths = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.deleted_book_thumbnail_paths()?
    };
    let thumbnail_files_removed = cache::remove_cache_files(&thumbnail_root, &paths)? as i64;
    let mut db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    let mut result = db.purge_deleted_books()?;
    result.thumbnail_files_removed = thumbnail_files_removed;
    Ok(result)
}

#[tauri::command]
pub fn list_books(state: State<'_, AppState>, query: BookQuery) -> Result<Vec<Book>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_books(query)
}

#[tauri::command]
pub fn get_book(state: State<'_, AppState>, id: i64) -> Result<Book> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.get_book(id)
}

#[tauri::command]
pub fn get_book_by_path(state: State<'_, AppState>, path: String) -> Result<Option<Book>> {
    let path = canonical_root(path)?;
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.get_book_by_path(&path)
}

#[tauri::command]
pub fn update_book_metadata(
    state: State<'_, AppState>,
    id: i64,
    update: MetadataUpdate,
) -> Result<Book> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.update_book_metadata(id, update)
}

#[tauri::command]
pub fn toggle_favorite(state: State<'_, AppState>, id: i64) -> Result<Book> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.toggle_favorite(id)
}

#[tauri::command]
pub fn set_rating(state: State<'_, AppState>, id: i64, rating: i64) -> Result<Book> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.set_rating(id, rating)
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<String>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_tags()
}

#[tauri::command]
pub fn list_categories(state: State<'_, AppState>) -> Result<Vec<String>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_categories()
}

#[tauri::command]
pub fn list_authors(state: State<'_, AppState>) -> Result<Vec<String>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_authors()
}

#[tauri::command]
pub fn list_formats(state: State<'_, AppState>) -> Result<Vec<String>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_formats()
}

#[tauri::command]
pub fn set_book_tags(
    state: State<'_, AppState>,
    book_id: i64,
    tags: Vec<String>,
) -> Result<Vec<String>> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.set_book_tags(book_id, tags)
}

#[tauri::command]
pub fn get_book_pages(state: State<'_, AppState>, book_id: i64) -> Result<Vec<BookPage>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.pages_for_book(book_id)
}

#[tauri::command]
pub fn get_book_chapters(state: State<'_, AppState>, book_id: i64) -> Result<Vec<Chapter>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.chapters_for_book(book_id)
}

#[tauri::command]
pub async fn get_page_data(
    app: AppHandle,
    state: State<'_, AppState>,
    book_id: i64,
    page_index: i64,
    trim_white: bool,
    sharpen: bool,
) -> Result<PagePayload> {
    let materialize_started_at = Instant::now();
    tauri_plugin_log::log::debug!(
        "reader_perf event=materialize_start book_id={book_id} page_index={page_index}"
    );
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?
        .join("reader-pages");
    let (book_path, source_paths, cache_key, limits, transforms) = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        let page = db
            .page_source_for_book(book_id, page_index)?
            .ok_or_else(|| MangaVaultError::Message(format!("page not found: {page_index}")))?;
        let prefer_enhanced = db.prefer_enhanced_pages()?;
        let source_paths = reader::page_source_candidates(&page.source_path, prefer_enhanced);
        let transforms = reader::PageTransforms {
            trim_white,
            sharpen,
        };
        let cache_key = reader::page_cache_key_for_source_with_transforms(
            &page.book_path,
            &page.book_updated_at,
            page_index,
            &source_paths[0],
            transforms,
        );
        (
            page.book_path,
            source_paths,
            cache_key,
            db.archive_limits()?,
            transforms,
        )
    };
    let materialize_cache_dir = cache_dir.clone();
    let page = tauri::async_runtime::spawn_blocking(move || {
        reader::materialize_page_from_candidates_with_limits_and_transforms(
            &materialize_cache_dir,
            Path::new(&book_path),
            &source_paths,
            &cache_key,
            page_index,
            limits,
            transforms,
        )
    })
    .await
    .map_err(|err| MangaVaultError::Message(err.to_string()))??;
    if page.wrote {
        let keep = page.payload.file_path.as_ref().map(PathBuf::from);
        std::thread::spawn(move || {
            let _ = cache::prune_directory_to_size(&cache_dir, 1024 * 1024 * 1024, keep.as_deref());
        });
    }
    tauri_plugin_log::log::debug!(
        "reader_perf event=materialize_end book_id={book_id} page_index={page_index} elapsed_ms={}",
        materialize_started_at.elapsed().as_secs_f64() * 1000.0
    );
    Ok(page.payload)
}

#[tauri::command]
pub async fn get_thumbnail_data(
    app: AppHandle,
    state: State<'_, AppState>,
    book_id: i64,
    page_index: i64,
) -> Result<PagePayload> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?
        .join("thumbnails");
    let (
        book_path,
        source_paths,
        cache_key,
        cached_path,
        limits,
        thumbnail_cache_limit,
        database_path,
    ) = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        let page = db
            .page_source_for_book(book_id, page_index)?
            .ok_or_else(|| MangaVaultError::Message(format!("page not found: {page_index}")))?;
        let prefer_enhanced = db.prefer_enhanced_pages()?;
        let source_paths = reader::page_source_candidates(&page.source_path, prefer_enhanced);
        let cache_key = reader::page_cache_key_for_source(
            &page.book_path,
            &page.book_updated_at,
            page_index,
            &source_paths[0],
        );
        let cached_path = db.find_thumbnail_path(book_id, page_index, &cache_key)?;
        (
            page.book_path,
            source_paths,
            cache_key,
            cached_path,
            db.archive_limits()?,
            db.thumbnail_cache_limit_bytes()?,
            db.path().to_path_buf(),
        )
    };
    let load_cache_key = cache_key.clone();
    let thumbnail_cache_dir = cache_dir.clone();
    let thumbnail = tauri::async_runtime::spawn_blocking(move || {
        reader::load_thumbnail_from_candidates_with_limits(
            &thumbnail_cache_dir,
            Path::new(&book_path),
            &source_paths,
            &load_cache_key,
            cached_path,
            page_index,
            limits,
        )
    })
    .await
    .map_err(|err| MangaVaultError::Message(err.to_string()))??;
    if let Some(write) = thumbnail.write {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.upsert_thumbnail(ThumbnailRecord {
            book_id,
            page_index,
            cache_key: &cache_key,
            disk_path: &write.disk_path,
            width: write.width,
            height: write.height,
            byte_size: write.byte_size,
        })?;
        let keep = Some(write.disk_path.clone());
        std::thread::spawn(move || {
            let removed = cache::prune_directory_to_size_with_paths(
                &cache_dir,
                thumbnail_cache_limit,
                keep.as_deref(),
            );
            if let Ok(removed) = removed {
                if let Ok(db) = Database::open(database_path) {
                    let _ = db.delete_thumbnail_records_by_paths(&removed);
                }
            }
        });
    }
    Ok(thumbnail.payload)
}

#[tauri::command]
pub fn save_progress(
    state: State<'_, AppState>,
    book_id: i64,
    current_page: i64,
    total_pages: i64,
    mode: String,
    direction: String,
) -> Result<crate::models::ReadingProgress> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.save_progress(book_id, current_page, total_pages, mode, direction)
}

#[tauri::command]
pub fn record_reading_opened(
    state: State<'_, AppState>,
    book_id: i64,
    page_index: i64,
) -> Result<()> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.record_reading_opened(book_id, page_index)
}

#[tauri::command]
pub fn get_progress(
    state: State<'_, AppState>,
    book_id: i64,
) -> Result<Option<crate::models::ReadingProgress>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.get_progress(book_id)
}

#[tauri::command]
pub fn add_bookmark(
    state: State<'_, AppState>,
    book_id: i64,
    page_index: i64,
    note: Option<String>,
) -> Result<Bookmark> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.add_bookmark(book_id, page_index, note)
}

#[tauri::command]
pub fn remove_bookmark(state: State<'_, AppState>, id: i64) -> Result<()> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.remove_bookmark(id)
}

#[tauri::command]
pub fn list_bookmarks(state: State<'_, AppState>, book_id: i64) -> Result<Vec<Bookmark>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_bookmarks(book_id)
}

#[tauri::command]
pub fn list_history(state: State<'_, AppState>) -> Result<Vec<ReadingHistoryItem>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_history()
}

#[tauri::command]
pub fn list_recent_reading(
    state: State<'_, AppState>,
    query: crate::models::RecentReadingQuery,
) -> Result<crate::models::RecentReadingPage> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_recent_reading(query)
}

#[tauri::command]
pub fn remove_recent_reading(state: State<'_, AppState>, book_id: i64) -> Result<i64> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    Ok(db.remove_recent_reading(book_id)? as i64)
}

#[tauri::command]
pub fn reset_reading_progress(state: State<'_, AppState>, book_id: i64) -> Result<()> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.reset_reading_progress(book_id)
}

#[tauri::command]
pub fn mark_book_read(
    state: State<'_, AppState>,
    book_id: i64,
) -> Result<crate::models::ReadingProgress> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.mark_book_read(book_id)
}

#[tauri::command]
pub fn list_reader_profiles(state: State<'_, AppState>) -> Result<Vec<ReaderProfileRecord>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_reader_profiles()
}

#[tauri::command]
pub fn reader_settings_scope_counts(
    state: State<'_, AppState>,
) -> Result<ReaderSettingsScopeCounts> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.reader_settings_scope_counts()
}

#[tauri::command]
pub fn list_smart_collections(state: State<'_, AppState>) -> Result<Vec<SmartCollectionRecord>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_smart_collections()
}

#[tauri::command]
pub fn get_database_health(state: State<'_, AppState>) -> Result<DatabaseHealth> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.health()
}

#[tauri::command]
pub fn backup_database(state: State<'_, AppState>) -> Result<String> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    Ok(db.create_backup()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_backup_snapshots(state: State<'_, AppState>) -> Result<Vec<BackupSnapshot>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_backup_snapshots()
}

#[tauri::command]
pub fn get_database_restore_status(state: State<'_, AppState>) -> Result<DatabaseRestoreStatus> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.database_restore_status()
}

#[tauri::command]
pub fn schedule_database_restore(
    state: State<'_, AppState>,
    snapshot_path: String,
) -> Result<DatabaseRestoreStatus> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.schedule_database_restore(snapshot_path)
}

#[tauri::command]
pub fn cancel_database_restore(state: State<'_, AppState>) -> Result<DatabaseRestoreStatus> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.cancel_database_restore()
}

#[tauri::command]
pub async fn optimize_database(
    state: State<'_, AppState>,
    vacuum: bool,
) -> Result<DatabaseMaintenanceResult> {
    let database_path = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?
        .path()
        .to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        Database::open(database_path)?.optimize_database(vacuum)
    })
    .await
    .map_err(|err| MangaVaultError::Message(err.to_string()))?
}

#[tauri::command]
pub fn list_log_files(app: AppHandle) -> Result<Vec<LogFileInfo>> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?;
    logs::list_log_files_in_dir(&log_dir)
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<()> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?;
    std::fs::create_dir_all(&log_dir)?;
    app.opener()
        .open_path(log_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| MangaVaultError::Message(err.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn report_frontend_error(
    app: AppHandle,
    message: String,
    component_stack: String,
) -> Result<()> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?;
    logs::write_crash_report(
        &log_dir,
        "frontend",
        &format!("message={message}\n\ncomponent_stack:\n{component_stack}"),
    )?;
    Ok(())
}

#[tauri::command]
pub fn clear_upscale_cache(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CacheCleanupResult> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?
        .join("upscale");
    let paths = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.list_upscale_cache_paths()?
    };
    let files_removed = cache::remove_upscale_cache_files(&cache_root, &paths)? as i64;
    let records_removed = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.clear_upscale_cache_records()? as i64
    };
    Ok(CacheCleanupResult {
        records_removed,
        files_removed,
    })
}

#[tauri::command]
pub fn clear_application_caches(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CacheCleanupResult> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|err| MangaVaultError::Message(err.to_string()))?;
    let files_removed = ["reader-pages", "thumbnails", "upscale"]
        .into_iter()
        .map(|name| cache::clear_cache_directory(&cache_root.join(name)))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .sum::<usize>() as i64;
    let records_removed = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        (db.clear_thumbnail_records()? + db.clear_upscale_cache_records()?) as i64
    };
    Ok(CacheCleanupResult {
        records_removed,
        files_removed,
    })
}

#[tauri::command]
pub fn clear_reading_history(state: State<'_, AppState>) -> Result<i64> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    Ok(db.clear_reading_history()? as i64)
}

#[tauri::command]
pub fn reset_application_settings(state: State<'_, AppState>) -> Result<serde_json::Value> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.reset_settings()
}

#[tauri::command]
pub fn list_feature_flags(state: State<'_, AppState>) -> Result<Vec<FeatureFlagRecord>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_feature_flags()
}

#[tauri::command]
pub fn get_license_state(state: State<'_, AppState>) -> Result<LicenseStateRecord> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.get_license_state()
}

#[tauri::command]
pub fn list_telemetry_settings(state: State<'_, AppState>) -> Result<Vec<TelemetrySettingRecord>> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.list_telemetry_settings()
}

#[tauri::command]
pub fn get_ocr_translation_status(state: State<'_, AppState>) -> Result<OcrTranslationStatus> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.ocr_translation_status()
}

#[tauri::command]
pub fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatusRecord> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.sync_status()
}

#[tauri::command]
pub fn get_plugin_status(state: State<'_, AppState>) -> Result<PluginStatusRecord> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.plugin_status()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.get_settings()
}

#[tauri::command]
pub fn set_setting(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: serde_json::Value,
) -> Result<serde_json::Value> {
    let updated = {
        let db = state
            .db
            .lock()
            .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
        db.set_setting(key.clone(), value.clone())?
    };
    if key == "locale" {
        let locale = value.as_str().unwrap_or("zh-CN");
        if let Err(err) = crate::update_tray_menu(&app, locale) {
            tauri_plugin_log::log::warn!("failed to update tray menu locale: {err}");
        }
    }
    Ok(updated)
}

#[tauri::command]
pub fn get_startup_data_status(state: State<'_, AppState>) -> Result<StartupDataStatus> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    let summary = db.local_data_summary()?;
    let has_user_data = summary.libraries > 0
        || summary.books > 0
        || summary.reading_history > 0
        || summary.reading_progress > 0
        || summary.bookmarks > 0;
    let reset_outcome = state
        .reset_outcome
        .lock()
        .map_err(|_| MangaVaultError::Message("reset outcome lock poisoned".to_string()))?
        .clone();
    Ok(StartupDataStatus {
        app_data_path: db
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy()
            .to_string(),
        had_existing_database: state.had_existing_database,
        should_prompt: state.had_existing_database
            && has_user_data
            && !db.existing_data_notice_acknowledged()?,
        summary,
        reset_outcome,
    })
}

#[tauri::command]
pub fn acknowledge_existing_data(state: State<'_, AppState>) -> Result<()> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.acknowledge_existing_data_notice()
}

#[tauri::command]
pub fn schedule_database_reset(state: State<'_, AppState>) -> Result<DatabaseResetSchedule> {
    let db = state
        .db
        .lock()
        .map_err(|_| MangaVaultError::Message("database lock poisoned".to_string()))?;
    db.schedule_database_reset()
}

#[tauri::command]
pub fn restart_application(app: AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn open_path_in_shell(app: AppHandle, path: String) -> Result<()> {
    let canonical = canonical_root(path)?;
    let target = library_root_for(&canonical)?;
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| MangaVaultError::Message(err.to_string()))?;
    Ok(())
}

fn canonical_root(path: String) -> Result<PathBuf> {
    let raw = PathBuf::from(path);
    let canonical = raw.canonicalize()?;
    if canonical
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(MangaVaultError::InvalidPath);
    }
    Ok(canonical)
}

fn library_root_for(root: &Path) -> Result<PathBuf> {
    if root.is_file() {
        root.parent()
            .ok_or(MangaVaultError::InvalidPath)
            .map(Path::to_path_buf)
    } else {
        Ok(root.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_or_empty_match_tokens_are_rejected() {
        assert!(validate_jmcomic_preview_token("current", "current").is_ok());
        assert!(validate_jmcomic_preview_token("current", "stale").is_err());
        assert!(validate_jmcomic_preview_token("", "").is_err());
    }
}
