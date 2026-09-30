use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::Utc;
use rusqlite::{params, types::ToSql, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::archive::ArchiveLimits;
use crate::error::{MangaVaultError, Result};
use crate::models::{
    BackupSnapshot, Book, BookPage, BookQuery, Bookmark, Chapter, DatabaseHealth,
    DatabaseMaintenanceResult, DatabaseResetOutcome, DatabaseResetSchedule, DatabaseRestoreStatus,
    DeletedBookCleanupPreview, DeletedBookCleanupResult, ExternalBookIdentity,
    ExternalBookMetadata, ExternalIdentityCandidate, ExternalIdentityImportResult,
    ExternalMatchBook, FeatureFlagRecord, JmComicBookSource, Library, LibraryRemovalPreview,
    LibraryRemovalResult, LicenseStateRecord, LocalDataSummary, MetadataFieldDiff,
    MetadataJobRecord, MetadataMergePreview, MetadataUpdate, OcrTranslationStatus,
    PluginStatusRecord, ReaderProfileRecord, ReaderSettingsScopeCounts, ReadingHistoryItem,
    ReadingProgress, RecentReadingItem, RecentReadingPage, RecentReadingQuery, ScanFailure,
    ScanJob, SmartCollectionRecord, SyncStatusRecord, TelemetrySettingRecord,
};

const INITIAL_MIGRATION: &str = include_str!("../migrations/001_initial.sql");
const SEED_MIGRATION: &str = include_str!("../migrations/002_seed.sql");
const EXTENSION_MIGRATION: &str = include_str!("../migrations/003_extensions.sql");
const LIBRARY_PERFORMANCE_MIGRATION: &str =
    include_str!("../migrations/004_library_performance.sql");
const SCAN_RELIABILITY_MIGRATION: &str = include_str!("../migrations/005_scan_reliability.sql");
const READER_V1_MIGRATION: &str = include_str!("../migrations/006_reader_v1.sql");
const PAGE_SOURCE_PREFERENCE_MIGRATION: &str =
    include_str!("../migrations/007_page_source_preference.sql");
const SCAN_FAILURES_MIGRATION: &str = include_str!("../migrations/008_scan_failures.sql");
const JMCOMIC_METADATA_MIGRATION: &str = include_str!("../migrations/009_jmcomic_metadata.sql");
const JMCOMIC_READER_METADATA_MIGRATION: &str =
    include_str!("../migrations/010_jmcomic_reader_metadata.sql");

const MIGRATIONS: &[(i64, &str)] = &[
    (1, INITIAL_MIGRATION),
    (3, EXTENSION_MIGRATION),
    (4, LIBRARY_PERFORMANCE_MIGRATION),
    (5, SCAN_RELIABILITY_MIGRATION),
    (6, READER_V1_MIGRATION),
    (7, PAGE_SOURCE_PREFERENCE_MIGRATION),
    (8, SCAN_FAILURES_MIGRATION),
    (9, JMCOMIC_METADATA_MIGRATION),
    (10, JMCOMIC_READER_METADATA_MIGRATION),
];

const MAX_SCAN_FAILURES_PER_JOB: i64 = 100;
const EXISTING_DATA_NOTICE_KEY: &str = "app.existing_data_notice_acknowledged";

pub struct Database {
    conn: Connection,
    path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingDatabaseRestore {
    snapshot_path: String,
    scheduled_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingDatabaseReset {
    backup_path: String,
    scheduled_at: String,
}

#[derive(Debug, Clone)]
pub struct ScannedBook {
    pub library_id: i64,
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
    pub checksum: Option<String>,
    pub pages: Vec<ScannedPage>,
}

#[derive(Debug, Clone)]
pub struct ScannedPage {
    pub page_index: i64,
    pub source_path: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub byte_size: Option<i64>,
}

#[derive(Debug, Clone)]
struct ChapterSeed {
    title: String,
    chapter_number: Option<f64>,
    start_page: i64,
    page_count: i64,
}

#[derive(Debug, Clone)]
pub struct ThumbnailRecord<'a> {
    pub book_id: i64,
    pub page_index: i64,
    pub cache_key: &'a str,
    pub disk_path: &'a Path,
    pub width: i64,
    pub height: i64,
    pub byte_size: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageSource {
    pub book_path: String,
    pub book_updated_at: String,
    pub source_path: String,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path.as_ref())?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        Ok(Self {
            conn,
            path: path.as_ref().to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn migrate(&self) -> Result<()> {
        self.apply_migrations(MIGRATIONS)
    }

    pub fn migrate_and_seed_with_snapshot(&self) -> Result<Option<PathBuf>> {
        let snapshot = if self.should_snapshot_before_migration()? {
            Some(self.create_backup_with_reason("pre-migration")?)
        } else {
            None
        };

        if let Err(error) = self.migrate().and_then(|_| self.seed_defaults()) {
            let message = match &snapshot {
                Some(path) => format!(
                    "database migration failed; the original database was left unchanged and a pre-migration backup is available at {}: {error}",
                    path.to_string_lossy()
                ),
                None => format!("database migration failed before any schema changes were committed: {error}"),
            };
            return Err(MangaVaultError::Message(message));
        }

        if let Some(path) = &snapshot {
            self.record_backup_snapshot(path, "pre-migration")?;
        }
        Ok(snapshot)
    }

    fn apply_migrations(&self, migrations: &[(i64, &str)]) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )?;
        for (version, migration) in migrations {
            let applied = self
                .conn
                .query_row(
                    "SELECT 1 FROM schema_migrations WHERE version=?1",
                    params![version],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if applied {
                continue;
            }
            self.conn.execute_batch("BEGIN IMMEDIATE;")?;
            let result = (|| -> Result<()> {
                self.conn.execute_batch(migration)?;
                self.conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                    params![version, now()],
                )?;
                self.conn
                    .execute_batch(&format!("PRAGMA user_version = {version};"))?;
                Ok(())
            })();
            match result {
                Ok(()) => self.conn.execute_batch("COMMIT;")?,
                Err(error) => {
                    let _ = self.conn.execute_batch("ROLLBACK;");
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    fn should_snapshot_before_migration(&self) -> Result<bool> {
        if !self.has_user_schema()? {
            return Ok(false);
        }
        if !self.has_table("schema_migrations")? {
            return Ok(true);
        }
        for (version, _) in MIGRATIONS {
            let applied = self
                .conn
                .query_row(
                    "SELECT 1 FROM schema_migrations WHERE version=?1",
                    params![version],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !applied {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn has_user_schema(&self) -> Result<bool> {
        self.conn
            .query_row(
                "SELECT 1 FROM sqlite_master
                 WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
                 LIMIT 1",
                [],
                |_| Ok(()),
            )
            .optional()
            .map(|value| value.is_some())
            .map_err(Into::into)
    }

    fn has_table(&self, name: &str) -> Result<bool> {
        self.conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1",
                params![name],
                |_| Ok(()),
            )
            .optional()
            .map(|value| value.is_some())
            .map_err(Into::into)
    }

    pub fn seed_defaults(&self) -> Result<()> {
        self.conn.execute_batch(SEED_MIGRATION)?;
        let jmcomic_enabled = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key='metadata.jmcomic.enabled'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|raw| serde_json::from_str::<bool>(&raw).ok())
            .unwrap_or(false);
        self.conn.execute(
            "UPDATE metadata_sources SET enabled=?1, updated_at=?2 WHERE provider_id='jmcomic'",
            params![jmcomic_enabled, now()],
        )?;
        Ok(())
    }

    pub fn backup_if_corrupt(&self) -> Result<Option<PathBuf>> {
        let ok: String = self
            .conn
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap_or_else(|_| "failed".to_string());
        if ok == "ok" {
            return Ok(None);
        }
        let backup_path = database_snapshot_path(&self.path, "corrupt");
        std::fs::copy(&self.path, &backup_path)?;
        Ok(Some(backup_path))
    }

    pub fn health(&self) -> Result<DatabaseHealth> {
        let message: String = self
            .conn
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap_or_else(|err| format!("quick_check failed: {err}"));
        Ok(DatabaseHealth {
            ok: message == "ok",
            message,
            backup_path: None,
        })
    }

    pub fn create_backup(&self) -> Result<PathBuf> {
        self.create_backup_with_reason("manual")
    }

    pub fn local_data_summary(&self) -> Result<LocalDataSummary> {
        self.conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM libraries),
                    (SELECT COUNT(*) FROM books WHERE status <> 'deleted'),
                    (SELECT COUNT(*) FROM reading_history),
                    (SELECT COUNT(*) FROM reading_progress),
                    (SELECT COUNT(*) FROM bookmarks)",
                [],
                |row| {
                    Ok(LocalDataSummary {
                        libraries: row.get(0)?,
                        books: row.get(1)?,
                        reading_history: row.get(2)?,
                        reading_progress: row.get(3)?,
                        bookmarks: row.get(4)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn existing_data_notice_acknowledged(&self) -> Result<bool> {
        let raw = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                params![EXISTING_DATA_NOTICE_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(raw
            .and_then(|value| serde_json::from_str::<bool>(&value).ok())
            .unwrap_or(false))
    }

    pub fn acknowledge_existing_data_notice(&self) -> Result<()> {
        self.set_setting(
            EXISTING_DATA_NOTICE_KEY.to_string(),
            serde_json::Value::Bool(true),
        )?;
        Ok(())
    }

    pub fn schedule_database_reset(&self) -> Result<DatabaseResetSchedule> {
        let active_jobs: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM scan_jobs WHERE status IN ('queued', 'running', 'cancelling')",
            [],
            |row| row.get(0),
        )?;
        if active_jobs > 0 {
            return Err(MangaVaultError::Message(
                "database reset cannot be scheduled while a scan is active".to_string(),
            ));
        }
        if pending_restore_path(&self.path).exists() {
            return Err(MangaVaultError::Message(
                "cancel the pending database restore before starting over".to_string(),
            ));
        }
        if pending_reset_path(&self.path).exists() {
            return Err(MangaVaultError::Message(
                "database reset is already scheduled".to_string(),
            ));
        }

        let backup_path = self.create_backup_with_reason("pre-reset")?;
        if !healthy_sqlite_file(&backup_path) {
            return Err(MangaVaultError::Message(
                "database backup failed its health check; reset was not scheduled".to_string(),
            ));
        }
        let scheduled_at = now();
        write_pending_reset(
            &self.path,
            &PendingDatabaseReset {
                backup_path: backup_path.to_string_lossy().to_string(),
                scheduled_at: scheduled_at.clone(),
            },
        )?;
        Ok(DatabaseResetSchedule {
            backup_path: backup_path.to_string_lossy().to_string(),
            scheduled_at,
            restart_required: true,
        })
    }

    pub fn list_backup_snapshots(&self) -> Result<Vec<BackupSnapshot>> {
        if !self.has_table("backup_snapshots")? {
            return Ok(Vec::new());
        }
        let mut statement = self.conn.prepare(
            "SELECT id, snapshot_path, reason, byte_size, created_at
             FROM backup_snapshots
             ORDER BY created_at DESC
             LIMIT 50",
        )?;
        let snapshots = statement
            .query_map([], |row| {
                Ok(BackupSnapshot {
                    id: row.get(0)?,
                    snapshot_path: row.get(1)?,
                    reason: row.get(2)?,
                    byte_size: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(snapshots
            .into_iter()
            .filter(|snapshot| {
                let path = PathBuf::from(&snapshot.snapshot_path);
                managed_snapshot_path(&self.path, &path) && healthy_sqlite_file(&path)
            })
            .collect())
    }

    pub fn database_restore_status(&self) -> Result<DatabaseRestoreStatus> {
        let pending = read_pending_restore(&self.path)?;
        let pending_snapshot = pending
            .and_then(|request| self.snapshot_by_path(&request.snapshot_path).ok().flatten())
            .filter(|snapshot| {
                let path = PathBuf::from(&snapshot.snapshot_path);
                managed_snapshot_path(&self.path, &path) && healthy_sqlite_file(&path)
            });
        Ok(DatabaseRestoreStatus { pending_snapshot })
    }

    pub fn schedule_database_restore(
        &self,
        snapshot_path: String,
    ) -> Result<DatabaseRestoreStatus> {
        if pending_reset_path(&self.path).exists() {
            return Err(MangaVaultError::Message(
                "restart the application to finish the pending database reset first".to_string(),
            ));
        }
        let snapshot = self
            .snapshot_by_path(&snapshot_path)?
            .ok_or_else(|| MangaVaultError::Message("backup snapshot was not found".to_string()))?;
        let path = PathBuf::from(&snapshot.snapshot_path);
        if !managed_snapshot_path(&self.path, &path) || !healthy_sqlite_file(&path) {
            return Err(MangaVaultError::Message(
                "backup snapshot is not a healthy MangaVault-managed snapshot".to_string(),
            ));
        }
        write_pending_restore(
            &self.path,
            &PendingDatabaseRestore {
                snapshot_path: snapshot.snapshot_path.clone(),
                scheduled_at: now(),
            },
        )?;
        Ok(DatabaseRestoreStatus {
            pending_snapshot: Some(snapshot),
        })
    }

    pub fn cancel_database_restore(&self) -> Result<DatabaseRestoreStatus> {
        let pending_path = pending_restore_path(&self.path);
        if pending_path.exists() {
            std::fs::remove_file(pending_path)?;
        }
        Ok(DatabaseRestoreStatus {
            pending_snapshot: None,
        })
    }

    fn snapshot_by_path(&self, snapshot_path: &str) -> Result<Option<BackupSnapshot>> {
        if !self.has_table("backup_snapshots")? {
            return Ok(None);
        }
        self.conn
            .query_row(
                "SELECT id, snapshot_path, reason, byte_size, created_at
                 FROM backup_snapshots WHERE snapshot_path=?1",
                params![snapshot_path],
                |row| {
                    Ok(BackupSnapshot {
                        id: row.get(0)?,
                        snapshot_path: row.get(1)?,
                        reason: row.get(2)?,
                        byte_size: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn create_backup_with_reason(&self, reason: &str) -> Result<PathBuf> {
        let backup_path = database_snapshot_path(&self.path, "backup");
        let temporary = backup_path.with_extension("sqlite3.tmp");
        let _ = std::fs::remove_file(&temporary);
        let quoted = sqlite_string(&temporary.to_string_lossy());
        self.conn.execute_batch(&format!("VACUUM INTO {quoted};"))?;
        std::fs::rename(&temporary, &backup_path)?;
        self.record_backup_snapshot(&backup_path, reason)?;
        Ok(backup_path)
    }

    fn record_backup_snapshot(&self, backup_path: &Path, reason: &str) -> Result<()> {
        if !self.has_table("backup_snapshots")? {
            return Ok(());
        }
        let byte_size = std::fs::metadata(backup_path)?.len() as i64;
        self.conn.execute(
            "INSERT OR REPLACE INTO backup_snapshots(snapshot_path, reason, byte_size, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![
                backup_path.to_string_lossy().to_string(),
                reason,
                byte_size,
                now()
            ],
        )?;
        Ok(())
    }

    pub fn open_with_recovery(path: impl AsRef<Path>) -> Result<(Self, Option<PathBuf>)> {
        let path = path.as_ref().to_path_buf();
        match Self::open(&path) {
            Ok(database) if database.health()?.ok => return Ok((database, None)),
            Ok(database) => drop(database),
            Err(error) if !path.exists() => return Err(error),
            Err(_) => {}
        }
        let corrupt_backup = backup_corrupt_database_files(&path)?;
        let latest_backup = latest_healthy_backup(&path);
        remove_database_files(&path)?;
        if let Some(backup) = latest_backup {
            std::fs::copy(backup, &path)?;
        }
        Ok((Self::open(path)?, Some(corrupt_backup)))
    }

    pub fn apply_pending_restore(path: impl AsRef<Path>) -> Result<Option<PathBuf>> {
        let path = path.as_ref().to_path_buf();
        let request = match read_pending_restore(&path) {
            Ok(request) => request,
            Err(error) => {
                tauri_plugin_log::log::warn!(
                    "ignored invalid pending database restore request: {error}"
                );
                quarantine_pending_restore(&path)?;
                None
            }
        };
        let Some(request) = request else {
            return Ok(None);
        };
        let snapshot = PathBuf::from(&request.snapshot_path);
        if !managed_snapshot_path(&path, &snapshot) || !healthy_sqlite_file(&snapshot) {
            quarantine_pending_restore(&path)?;
            return Ok(None);
        }

        let safety_backup = snapshot_database_files(&path, "pre-restore")?;
        let staged = path.with_extension("restore-staged.sqlite3");
        let _ = std::fs::remove_file(&staged);
        std::fs::copy(&snapshot, &staged)?;
        if !healthy_sqlite_file(&staged) {
            let _ = std::fs::remove_file(&staged);
            return Err(MangaVaultError::Message(
                "scheduled database restore staging check failed".to_string(),
            ));
        }
        remove_database_files(&path)?;
        if let Err(error) = std::fs::rename(&staged, &path) {
            std::fs::copy(&staged, &path)?;
            std::fs::remove_file(&staged)?;
            if !path.exists() {
                return Err(MangaVaultError::Message(format!(
                    "scheduled database restore could not replace the database: {error}"
                )));
            }
        }
        let pending_path = pending_restore_path(&path);
        if pending_path.exists() {
            std::fs::remove_file(pending_path)?;
        }
        Ok(safety_backup)
    }

    pub fn apply_pending_reset(path: impl AsRef<Path>) -> Result<Option<DatabaseResetOutcome>> {
        let path = path.as_ref().to_path_buf();
        let request = match read_pending_reset(&path) {
            Ok(request) => request,
            Err(error) => {
                quarantine_pending_reset(&path)?;
                return Ok(Some(DatabaseResetOutcome {
                    success: false,
                    backup_path: None,
                    archive_path: None,
                    message: format!("invalid pending database reset request: {error}"),
                    reset_at: now(),
                }));
            }
        };
        let Some(request) = request else {
            return Ok(None);
        };
        let backup_path = PathBuf::from(&request.backup_path);
        if !managed_snapshot_path(&path, &backup_path) || !healthy_sqlite_file(&backup_path) {
            quarantine_pending_reset(&path)?;
            return Ok(Some(DatabaseResetOutcome {
                success: false,
                backup_path: Some(request.backup_path),
                archive_path: None,
                message:
                    "the safety backup is missing or unhealthy; the existing database was kept"
                        .to_string(),
                reset_at: now(),
            }));
        }

        let staged = path.with_extension("reset-staged.sqlite3");
        let _ = remove_database_files(&staged);
        let stage_result = (|| -> Result<()> {
            let staged_database = Self::open(&staged)?;
            staged_database.migrate_and_seed_with_snapshot()?;
            staged_database.acknowledge_existing_data_notice()?;
            staged_database
                .conn
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            drop(staged_database);
            if !healthy_sqlite_file(&staged) {
                return Err(MangaVaultError::Message(
                    "new empty database failed its health check".to_string(),
                ));
            }
            Ok(())
        })();
        if let Err(error) = stage_result {
            let _ = remove_database_files(&staged);
            quarantine_pending_reset(&path)?;
            return Ok(Some(DatabaseResetOutcome {
                success: false,
                backup_path: Some(request.backup_path),
                archive_path: None,
                message: format!(
                    "could not prepare a new database; the existing database was kept: {error}"
                ),
                reset_at: now(),
            }));
        }

        let archive_path = database_snapshot_path(&path, "reset-archive");
        let archive_result = (|| -> Result<()> {
            if !path.exists() {
                return Err(MangaVaultError::Message(
                    "the existing database no longer exists".to_string(),
                ));
            }
            let source = Self::open(&path)?;
            let quoted = sqlite_string(&archive_path.to_string_lossy());
            source
                .conn
                .execute_batch(&format!("VACUUM INTO {quoted};"))?;
            drop(source);
            if !healthy_sqlite_file(&archive_path) {
                return Err(MangaVaultError::Message(
                    "the archived database failed its health check".to_string(),
                ));
            }
            Ok(())
        })();
        if let Err(error) = archive_result {
            let _ = remove_database_files(&staged);
            let _ = std::fs::remove_file(&archive_path);
            quarantine_pending_reset(&path)?;
            return Ok(Some(DatabaseResetOutcome {
                success: false,
                backup_path: Some(request.backup_path),
                archive_path: None,
                message: format!("could not archive the existing database; it was kept: {error}"),
                reset_at: now(),
            }));
        }

        if let Err(remove_error) = remove_database_files(&path) {
            if !healthy_sqlite_file(&path) {
                let _ = remove_database_files(&path);
                std::fs::copy(&archive_path, &path)?;
            }
            if !healthy_sqlite_file(&path) {
                return Err(MangaVaultError::Message(format!(
                    "database reset could not remove the active database and recovery failed: {remove_error}"
                )));
            }
            let _ = remove_database_files(&staged);
            quarantine_pending_reset(&path)?;
            return Ok(Some(DatabaseResetOutcome {
                success: false,
                backup_path: Some(request.backup_path),
                archive_path: Some(archive_path.to_string_lossy().to_string()),
                message: format!(
                    "database reset could not replace the active database; it was kept or restored: {remove_error}"
                ),
                reset_at: now(),
            }));
        }
        if let Err(replace_error) = move_database_file(&staged, &path) {
            let _ = remove_database_files(&path);
            std::fs::copy(&archive_path, &path)?;
            if !healthy_sqlite_file(&path) {
                return Err(MangaVaultError::Message(format!(
                    "database reset failed and the archived database could not be restored: {replace_error}"
                )));
            }
            quarantine_pending_reset(&path)?;
            return Ok(Some(DatabaseResetOutcome {
                success: false,
                backup_path: Some(request.backup_path),
                archive_path: Some(archive_path.to_string_lossy().to_string()),
                message: format!(
                    "database reset failed; the archived database was restored: {replace_error}"
                ),
                reset_at: now(),
            }));
        }
        if !healthy_sqlite_file(&path) {
            remove_database_files(&path)?;
            std::fs::copy(&archive_path, &path)?;
            if !healthy_sqlite_file(&path) {
                return Err(MangaVaultError::Message(
                    "new database failed validation and the archived database could not be restored"
                        .to_string(),
                ));
            }
            quarantine_pending_reset(&path)?;
            return Ok(Some(DatabaseResetOutcome {
                success: false,
                backup_path: Some(request.backup_path),
                archive_path: Some(archive_path.to_string_lossy().to_string()),
                message: "new database failed validation; the archived database was restored"
                    .to_string(),
                reset_at: now(),
            }));
        }
        let _ = remove_database_files(&staged);

        let request_path = pending_reset_path(&path);
        if request_path.exists() {
            std::fs::remove_file(request_path)?;
        }
        Ok(Some(DatabaseResetOutcome {
            success: true,
            backup_path: Some(request.backup_path),
            archive_path: Some(archive_path.to_string_lossy().to_string()),
            message: "a new empty database was created; the previous database and safety backup were preserved"
                .to_string(),
            reset_at: now(),
        }))
    }

    pub fn register_reset_snapshots(&self, outcome: &DatabaseResetOutcome) -> Result<()> {
        if !outcome.success {
            return Ok(());
        }
        if let Some(path) = outcome.backup_path.as_deref() {
            self.record_backup_snapshot(Path::new(path), "pre-reset")?;
        }
        if let Some(path) = outcome.archive_path.as_deref() {
            self.record_backup_snapshot(Path::new(path), "reset-archive")?;
        }
        Ok(())
    }

    pub fn archive_limits(&self) -> Result<ArchiveLimits> {
        let defaults = ArchiveLimits::default();
        Ok(ArchiveLimits {
            max_entry_bytes: self
                .setting_u64("scanner.max_extract_bytes", defaults.max_entry_bytes)?,
            max_total_bytes: self
                .setting_u64("scanner.max_total_extract_bytes", defaults.max_total_bytes)?,
            max_entries: self
                .setting_u64("scanner.max_archive_entries", defaults.max_entries as u64)?
                as usize,
            max_compression_ratio: self.setting_u64(
                "scanner.max_compression_ratio",
                defaults.max_compression_ratio,
            )?,
            max_image_pixels: self
                .setting_u64("scanner.max_image_pixels", defaults.max_image_pixels)?,
            command_timeout: std::time::Duration::from_secs(self.setting_u64(
                "scanner.command_timeout_seconds",
                defaults.command_timeout.as_secs(),
            )?),
            max_command_output_bytes: self.setting_u64(
                "scanner.max_command_output_bytes",
                defaults.max_command_output_bytes,
            )?,
        }
        .sanitized())
    }

    pub fn thumbnail_cache_limit_bytes(&self) -> Result<u64> {
        let megabytes = self.setting_u64("cache.thumbnail_limit_mb", 2048)?;
        Ok(megabytes.clamp(128, 16_384) * 1024 * 1024)
    }

    pub fn prefer_enhanced_pages(&self) -> Result<bool> {
        let settings = self.get_settings()?;
        Ok(settings
            .get("reader.prefer_enhanced_pages")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true))
    }

    pub fn optimize_database(&self, vacuum: bool) -> Result<DatabaseMaintenanceResult> {
        let started = Instant::now();
        let page_count_before = self.pragma_i64("page_count")?;
        let freelist_count_before = self.pragma_i64("freelist_count")?;
        self.conn.execute_batch("PRAGMA optimize; ANALYZE;")?;
        if vacuum {
            self.conn.execute_batch("VACUUM;")?;
        }
        let page_count_after = self.pragma_i64("page_count")?;
        let freelist_count_after = self.pragma_i64("freelist_count")?;
        Ok(DatabaseMaintenanceResult {
            vacuum,
            page_count_before,
            page_count_after,
            freelist_count_before,
            freelist_count_after,
            elapsed_ms: started.elapsed().as_millis() as i64,
        })
    }

    pub fn upsert_library(&self, root_path: &Path, recursive: bool) -> Result<Library> {
        let now = now();
        let name = root_path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("Manga Library")
            .to_string();
        let root = root_path.to_string_lossy().to_string();
        self.conn.execute(
            "INSERT INTO libraries(name, root_path, recursive, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(root_path) DO UPDATE SET recursive=excluded.recursive, updated_at=excluded.updated_at",
            params![name, root, recursive as i64, now],
        )?;
        self.get_library_by_path(root_path)
    }

    pub fn get_library_by_path(&self, root_path: &Path) -> Result<Library> {
        let root = root_path.to_string_lossy().to_string();
        self.conn
            .query_row(
                "SELECT l.id, l.name, l.root_path, l.recursive, l.created_at, l.updated_at,
                        l.last_scan_at,
                        (SELECT COUNT(*) FROM books b
                         WHERE b.library_id=l.id AND b.status <> 'deleted')
                 FROM libraries l WHERE l.root_path = ?1",
                params![root],
                map_library,
            )
            .map_err(Into::into)
    }

    pub fn list_libraries(&self) -> Result<Vec<Library>> {
        let mut stmt = self.conn.prepare(
            "SELECT l.id, l.name, l.root_path, l.recursive, l.created_at, l.updated_at,
                    l.last_scan_at,
                    (SELECT COUNT(*) FROM books b
                     WHERE b.library_id=l.id AND b.status <> 'deleted')
             FROM libraries l ORDER BY l.name COLLATE NOCASE ASC, l.root_path ASC",
        )?;
        let rows = stmt.query_map([], map_library)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn library_removal_preview(&self, library_id: i64) -> Result<LibraryRemovalPreview> {
        self.conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM books WHERE library_id=?1),
                    (SELECT COUNT(*) FROM pages p JOIN books b ON b.id=p.book_id WHERE b.library_id=?1),
                    (SELECT COUNT(*) FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.library_id=?1),
                    (SELECT COUNT(*) FROM bookmarks m JOIN books b ON b.id=m.book_id WHERE b.library_id=?1),
                    (SELECT COALESCE(SUM(t.byte_size), 0) FROM thumbnails t JOIN books b ON b.id=t.book_id WHERE b.library_id=?1)",
                params![library_id],
                |row| {
                    Ok(LibraryRemovalPreview {
                        library_id,
                        books: row.get(0)?,
                        pages: row.get(1)?,
                        chapters: row.get(2)?,
                        bookmarks: row.get(3)?,
                        thumbnail_bytes: row.get(4)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn library_thumbnail_paths(&self, library_id: i64) -> Result<Vec<PathBuf>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.disk_path FROM thumbnails t
             JOIN books b ON b.id=t.book_id
             WHERE b.library_id=?1",
        )?;
        let rows = stmt.query_map(params![library_id], |row| row.get::<_, String>(0))?;
        rows.map(|row| row.map(PathBuf::from))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn remove_library(&mut self, library_id: i64) -> Result<LibraryRemovalResult> {
        let preview = self.library_removal_preview(library_id)?;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM books WHERE library_id=?1", params![library_id])?;
        tx.execute("DELETE FROM libraries WHERE id=?1", params![library_id])?;
        tx.commit()?;
        Ok(LibraryRemovalResult {
            library_id,
            books_removed: preview.books,
            thumbnail_files_removed: 0,
        })
    }

    pub fn mark_library_scanned(&self, library_id: i64) -> Result<()> {
        let stamp = now();
        self.conn.execute(
            "UPDATE libraries SET last_scan_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![stamp, library_id],
        )?;
        Ok(())
    }

    pub fn create_scan_job(&self, library_id: Option<i64>, root_path: &Path) -> Result<i64> {
        let stamp = now();
        self.conn.execute(
            "INSERT INTO scan_jobs(library_id, root_path, status, started_at)
             VALUES (?1, ?2, 'queued', ?3)",
            params![library_id, root_path.to_string_lossy().to_string(), stamp],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_scan_job(
        &self,
        job_id: i64,
        status: &str,
        discovered: i64,
        imported: i64,
        failed: i64,
        message: Option<&str>,
    ) -> Result<()> {
        let finished =
            matches!(status, "complete" | "failed" | "cancelled" | "interrupted").then(now);
        self.conn.execute(
            "UPDATE scan_jobs
             SET status=?1, discovered_count=?2, imported_count=?3, failed_count=?4, message=?5, finished_at=?6
             WHERE id=?7",
            params![status, discovered, imported, failed, message, finished, job_id],
        )?;
        Ok(())
    }

    pub fn mark_scan_cancel_requested(&self, job_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE scan_jobs SET status='cancelling', message='cancel requested'
             WHERE id=?1 AND status IN ('queued', 'running')",
            params![job_id],
        )?;
        Ok(())
    }

    pub fn mark_interrupted_scan_jobs(&self) -> Result<usize> {
        Ok(self.conn.execute(
            "UPDATE scan_jobs
             SET status='interrupted', message='interrupted by previous app shutdown', finished_at=?1
             WHERE status IN ('queued', 'running', 'cancelling')",
            params![now()],
        )?)
    }

    pub fn retry_scan_target(&self, job_id: i64) -> Result<(PathBuf, bool)> {
        self.conn
            .query_row(
                "SELECT l.root_path, l.recursive
                 FROM scan_jobs j
                 JOIN libraries l ON l.id = j.library_id
                 WHERE j.id = ?1 AND j.status IN ('failed', 'cancelled', 'interrupted')",
                params![job_id],
                |row| Ok((PathBuf::from(row.get::<_, String>(0)?), row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| {
                crate::error::MangaVaultError::Message(
                    "scan job is not available for retry".to_string(),
                )
            })
    }

    pub fn list_scan_jobs(&self) -> Result<Vec<ScanJob>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, library_id, root_path, status, discovered_count, imported_count,
                    failed_count, message, started_at, finished_at
             FROM scan_jobs ORDER BY started_at DESC LIMIT 50",
        )?;
        let rows = stmt.query_map([], map_scan_job)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn record_scan_failure(
        &self,
        scan_job_id: i64,
        path: Option<&Path>,
        stage: &str,
        message: &str,
    ) -> Result<()> {
        let existing: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM scan_failures WHERE scan_job_id=?1",
            params![scan_job_id],
            |row| row.get(0),
        )?;
        if existing >= MAX_SCAN_FAILURES_PER_JOB {
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO scan_failures(scan_job_id, path, stage, message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                scan_job_id,
                path.map(|path| path.to_string_lossy().to_string()),
                stage.chars().take(48).collect::<String>(),
                message.chars().take(2_000).collect::<String>(),
                now(),
            ],
        )?;
        Ok(())
    }

    pub fn list_scan_failures(&self, scan_job_id: i64) -> Result<Vec<ScanFailure>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, scan_job_id, path, stage, message, created_at
             FROM scan_failures
             WHERE scan_job_id=?1
             ORDER BY id ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![scan_job_id, MAX_SCAN_FAILURES_PER_JOB], |row| {
            Ok(ScanFailure {
                id: row.get(0)?,
                scan_job_id: row.get(1)?,
                path: row.get(2)?,
                stage: row.get(3)?,
                message: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn upsert_scanned_book(&mut self, book: &ScannedBook) -> Result<i64> {
        if let Some(book_id) = self.unchanged_scanned_book_id(book)? {
            self.conn.execute(
                "UPDATE books SET status='available', updated_at=?1 WHERE id=?2 AND status != 'available'",
                params![now(), book_id],
            )?;
            return Ok(book_id);
        }

        let existing_metadata = self
            .conn
            .query_row(
                "SELECT series_id, title, sort_title, author, volume, chapter
                 FROM books WHERE path = ?1",
                params![book.path],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<f64>>(4)?,
                        row.get::<_, Option<f64>>(5)?,
                    ))
                },
            )
            .optional()?;
        let tx = self.conn.transaction()?;
        let stamp = now();
        let (series_id, title, sort_title, author, volume, chapter) = if let Some((
            series_id,
            title,
            sort_title,
            author,
            volume,
            chapter,
        )) = existing_metadata
        {
            let series_id = series_id.ok_or_else(|| {
                MangaVaultError::Message(format!("existing book has no series: {}", book.path))
            })?;
            (series_id, title, sort_title, author, volume, chapter)
        } else {
            tx.execute(
                    "INSERT INTO series(title, sort_title, author, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?4)
                     ON CONFLICT(title) DO UPDATE SET updated_at=excluded.updated_at, author=coalesce(excluded.author, series.author)",
                    params![book.title, book.sort_title, book.author, stamp],
                )?;
            let series_id: i64 = tx.query_row(
                "SELECT id FROM series WHERE title = ?1",
                params![book.title],
                |row| row.get(0),
            )?;
            (
                series_id,
                book.title.clone(),
                book.sort_title.clone(),
                book.author.clone(),
                book.volume,
                book.chapter,
            )
        };
        tx.execute(
            "INSERT INTO books(library_id, series_id, title, sort_title, author, volume, chapter, path,
                 format, file_size, modified_at, page_count, checksum, status, imported_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'available', ?14, ?14)
             ON CONFLICT(path) DO UPDATE SET
                 library_id=excluded.library_id,
                 format=excluded.format,
                 file_size=excluded.file_size,
                 modified_at=excluded.modified_at,
                 page_count=excluded.page_count,
                 checksum=excluded.checksum,
                 status='available',
                 updated_at=excluded.updated_at",
            params![
                book.library_id,
                series_id,
                title,
                sort_title,
                author,
                volume,
                chapter,
                book.path,
                book.format,
                book.file_size,
                book.modified_at,
                book.page_count,
                book.checksum,
                stamp
            ],
        )?;
        let book_id: i64 = tx.query_row(
            "SELECT id FROM books WHERE path = ?1",
            params![book.path],
            |row| row.get(0),
        )?;
        let book_path = Path::new(&book.path);
        let can_contain_nested_books = book.format == "folder"
            && book
                .pages
                .iter()
                .any(|page| page.source_path.contains('/') || page.source_path.contains('\\'));
        let nested_ids = if can_contain_nested_books {
            let mut nested_stmt = tx.prepare(
                "SELECT id, path FROM books
                 WHERE library_id = ?1 AND id != ?2 AND status = 'available'",
            )?;
            let rows = nested_stmt.query_map(params![book.library_id, book_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut ids = Vec::new();
            for row in rows {
                let (id, path) = row?;
                let existing_path = Path::new(&path);
                if existing_path.starts_with(book_path) {
                    ids.push(id);
                }
            }
            ids
        } else {
            Vec::new()
        };
        for nested_id in nested_ids {
            tx.execute(
                "UPDATE books SET status='deleted', updated_at=?1 WHERE id=?2",
                params![stamp, nested_id],
            )?;
        }
        tx.execute("DELETE FROM pages WHERE book_id = ?1", params![book_id])?;
        {
            let mut page_insert = tx.prepare(
                "INSERT INTO pages(book_id, page_index, source_path, width, height, byte_size, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for page in &book.pages {
                page_insert.execute(params![
                    book_id,
                    page.page_index,
                    page.source_path,
                    page.width,
                    page.height,
                    page.byte_size,
                    stamp
                ])?;
            }
        }
        tx.execute("DELETE FROM chapters WHERE book_id = ?1", params![book_id])?;
        {
            let mut chapter_insert = tx.prepare(
                "INSERT INTO chapters(book_id, title, chapter_number, start_page, page_count, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for chapter in infer_scanned_chapters(book) {
                chapter_insert.execute(params![
                    book_id,
                    chapter.title,
                    chapter.chapter_number,
                    chapter.start_page,
                    chapter.page_count,
                    stamp
                ])?;
            }
        }
        tx.commit()?;
        Ok(book_id)
    }

    pub fn mark_missing_books(&self, library_id: i64) -> Result<usize> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path FROM books WHERE library_id = ?1 AND status = 'available'")?;
        let rows = stmt.query_map(params![library_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut missing = Vec::new();
        for row in rows {
            let (id, path) = row?;
            if !Path::new(&path).exists() {
                missing.push(id);
            }
        }
        let stamp = now();
        for id in &missing {
            self.conn.execute(
                "UPDATE books SET status='missing', updated_at=?1 WHERE id=?2",
                params![stamp, id],
            )?;
        }
        Ok(missing.len())
    }

    pub fn mark_missing_books_not_in(
        &self,
        library_id: i64,
        discovered_paths: &HashSet<String>,
    ) -> Result<usize> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path FROM books WHERE library_id = ?1 AND status = 'available'")?;
        let rows = stmt.query_map(params![library_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut missing = Vec::new();
        for row in rows {
            let (id, path) = row?;
            if !discovered_paths.contains(&path) || !Path::new(&path).exists() {
                missing.push(id);
            }
        }
        let stamp = now();
        for id in &missing {
            self.conn.execute(
                "UPDATE books SET status='missing', updated_at=?1 WHERE id=?2",
                params![stamp, id],
            )?;
        }
        Ok(missing.len())
    }

    pub fn purge_missing_books(&self, library_id: Option<i64>) -> Result<usize> {
        let stamp = now();
        let changed = if let Some(library_id) = library_id {
            self.conn.execute(
                "UPDATE books SET status='deleted', updated_at=?1
                 WHERE library_id=?2 AND status='missing'",
                params![stamp, library_id],
            )?
        } else {
            self.conn.execute(
                "UPDATE books SET status='deleted', updated_at=?1 WHERE status='missing'",
                params![stamp],
            )?
        };
        Ok(changed)
    }

    pub fn deleted_book_cleanup_preview(&self) -> Result<DeletedBookCleanupPreview> {
        self.conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM books WHERE status='deleted'),
                    (SELECT COUNT(*) FROM pages p JOIN books b ON b.id=p.book_id WHERE b.status='deleted'),
                    (SELECT COUNT(*) FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.status='deleted'),
                    (SELECT COUNT(*) FROM thumbnails t JOIN books b ON b.id=t.book_id WHERE b.status='deleted'),
                    (SELECT COALESCE(SUM(t.byte_size), 0) FROM thumbnails t JOIN books b ON b.id=t.book_id WHERE b.status='deleted')",
                [],
                |row| {
                    Ok(DeletedBookCleanupPreview {
                        books: row.get(0)?,
                        pages: row.get(1)?,
                        chapters: row.get(2)?,
                        thumbnails: row.get(3)?,
                        thumbnail_bytes: row.get(4)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn deleted_book_thumbnail_paths(&self) -> Result<Vec<PathBuf>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.disk_path
             FROM thumbnails t
             JOIN books b ON b.id=t.book_id
             WHERE b.status='deleted'",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| row.map(PathBuf::from))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn purge_deleted_books(&mut self) -> Result<DeletedBookCleanupResult> {
        let preview = self.deleted_book_cleanup_preview()?;
        if preview.books == 0 {
            return Ok(DeletedBookCleanupResult {
                books_removed: 0,
                pages_removed: 0,
                chapters_removed: 0,
                thumbnail_records_removed: 0,
                thumbnail_files_removed: 0,
            });
        }
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM books WHERE status='deleted'", [])?;
        tx.commit()?;
        Ok(DeletedBookCleanupResult {
            books_removed: preview.books,
            pages_removed: preview.pages,
            chapters_removed: preview.chapters,
            thumbnail_records_removed: preview.thumbnails,
            thumbnail_files_removed: 0,
        })
    }

    pub fn list_books(&self, query: BookQuery) -> Result<Vec<Book>> {
        let sort = if query.view.as_deref() == Some("series") {
            "coalesce(s.sort_title, b.sort_title) COLLATE NOCASE ASC,
             b.series_id ASC NULLS LAST,
             b.volume ASC NULLS LAST,
             b.chapter ASC NULLS LAST,
             b.sort_title COLLATE NOCASE ASC,
             b.id ASC"
        } else {
            match query.sort.as_deref() {
                Some("author") => {
                    "b.author COLLATE NOCASE ASC, b.sort_title COLLATE NOCASE ASC, b.id ASC"
                }
                Some("recent") => {
                    "b.last_read_at DESC NULLS LAST, b.sort_title COLLATE NOCASE ASC, b.id ASC"
                }
                Some("imported") => "b.imported_at DESC, b.id DESC",
                Some("progress") => {
                    "coalesce(rp.percent, 0) DESC, b.sort_title COLLATE NOCASE ASC, b.id ASC"
                }
                Some("rating") => "b.rating DESC, b.sort_title COLLATE NOCASE ASC, b.id ASC",
                _ => "b.sort_title COLLATE NOCASE ASC, b.id ASC",
            }
        };
        let limit = query.limit.unwrap_or(500).clamp(1, 10_000);
        let offset = query.offset.unwrap_or(0).max(0);
        let mut sql = String::from(
            "SELECT b.id, b.library_id, b.series_id, b.title, b.sort_title, b.author, b.volume,
                    b.chapter, b.path, b.format, b.file_size, b.modified_at, b.page_count,
                    b.cover_page_index, b.cover_cache_key, b.is_favorite, b.rating, b.status,
                    b.imported_at, b.updated_at, b.last_read_at, coalesce(rp.percent, 0)
             FROM books b
             LEFT JOIN reading_progress rp ON rp.book_id = b.id
             LEFT JOIN series s ON s.id = b.series_id
             WHERE b.status != 'deleted'",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(favorite) = query.favorite {
            sql.push_str(" AND b.is_favorite = ?");
            args.push(Box::new(favorite as i64));
        }
        if let Some(author) = query.author.filter(|v| !v.trim().is_empty()) {
            sql.push_str(" AND b.author = ?");
            args.push(Box::new(author));
        }
        if let Some(format) = query.format.filter(|v| !v.trim().is_empty()) {
            sql.push_str(" AND b.format = ?");
            args.push(Box::new(format.to_ascii_lowercase()));
        }
        if let Some(status) = query.status.filter(|v| !v.trim().is_empty()) {
            sql.push_str(" AND b.status = ?");
            args.push(Box::new(status));
        }
        if let Some(min_rating) = query.min_rating {
            sql.push_str(" AND b.rating >= ?");
            args.push(Box::new(min_rating.clamp(0, 5)));
        }
        if query.duplicates_only.unwrap_or(false) {
            sql.push_str(
                " AND b.checksum IS NOT NULL
                  AND b.checksum IN (
                    SELECT checksum FROM books
                    WHERE checksum IS NOT NULL AND status != 'deleted'
                    GROUP BY checksum HAVING count(*) > 1
                  )",
            );
        }
        if let Some(tag) = query.tag.filter(|v| !v.trim().is_empty()) {
            sql.push_str(
                " AND (
                    b.id IN (
                      SELECT bt.book_id FROM tags t
                      JOIN book_tags bt ON bt.tag_id = t.id
                      WHERE t.name = ? COLLATE NOCASE
                    )
                    OR b.id IN (
                      SELECT ebt.book_id FROM external_book_tags ebt
                      WHERE ebt.source_tag = ? COLLATE NOCASE
                    )
                 )",
            );
            args.push(Box::new(tag.clone()));
            args.push(Box::new(tag));
        }
        if let Some(category) = query.category.filter(|v| !v.trim().is_empty()) {
            sql.push_str(
                " AND b.id IN (
                    SELECT ebc.book_id FROM external_book_categories ebc
                    WHERE ebc.source_category = ? COLLATE NOCASE
                 )",
            );
            args.push(Box::new(category));
        }
        if let Some(search) = query.search.filter(|v| !v.trim().is_empty()) {
            let like = format!("%{}%", escape_like(&search));
            if is_fts_prefix_query(&search) {
                sql.push_str(
                    " AND (b.id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ?)
                       OR b.title LIKE ? ESCAPE '\\'
                       OR coalesce(b.author, '') LIKE ? ESCAPE '\\'
                       OR b.path LIKE ? ESCAPE '\\'
                       OR EXISTS(SELECT 1 FROM external_book_ids ebi WHERE ebi.book_id=b.id AND ebi.remote_id LIKE ? ESCAPE '\\')
                       OR EXISTS(SELECT 1 FROM external_book_tags ebt WHERE ebt.book_id=b.id AND ebt.source_tag LIKE ? ESCAPE '\\')
                       OR EXISTS(SELECT 1 FROM external_book_categories ebc WHERE ebc.book_id=b.id AND ebc.source_category LIKE ? ESCAPE '\\')
                       OR EXISTS(SELECT 1 FROM external_book_metadata ebm WHERE ebm.book_id=b.id AND (coalesce(ebm.original_title, '') LIKE ? ESCAPE '\\' OR ebm.authors_json LIKE ? ESCAPE '\\')))",
                );
                args.push(Box::new(format!("{}*", escape_fts(&search))));
            } else {
                sql.push_str(
                    " AND (b.title LIKE ? ESCAPE '\\'
                       OR coalesce(b.author, '') LIKE ? ESCAPE '\\'
                       OR b.path LIKE ? ESCAPE '\\'
                       OR EXISTS(SELECT 1 FROM external_book_ids ebi WHERE ebi.book_id=b.id AND ebi.remote_id LIKE ? ESCAPE '\\')
                       OR EXISTS(SELECT 1 FROM external_book_tags ebt WHERE ebt.book_id=b.id AND ebt.source_tag LIKE ? ESCAPE '\\')
                       OR EXISTS(SELECT 1 FROM external_book_categories ebc WHERE ebc.book_id=b.id AND ebc.source_category LIKE ? ESCAPE '\\')
                       OR EXISTS(SELECT 1 FROM external_book_metadata ebm WHERE ebm.book_id=b.id AND (coalesce(ebm.original_title, '') LIKE ? ESCAPE '\\' OR ebm.authors_json LIKE ? ESCAPE '\\')))",
                );
            }
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
        }
        sql.push_str(" ORDER BY ");
        sql.push_str(sort);
        sql.push_str(" LIMIT ? OFFSET ?");
        args.push(Box::new(limit));
        args.push(Box::new(offset));
        let mut stmt = self.conn.prepare(&sql)?;
        let params = rusqlite::params_from_iter(args.iter().map(|v| &**v));
        let rows = stmt.query_map(params, Self::map_book_row_without_tags)?;
        let mut books = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(crate::error::MangaVaultError::from)?;
        self.attach_tags_to_books(&mut books)?;
        Ok(books)
    }

    pub fn get_book(&self, id: i64) -> Result<Book> {
        self.conn
            .query_row(
                "SELECT b.id, b.library_id, b.series_id, b.title, b.sort_title, b.author, b.volume,
                        b.chapter, b.path, b.format, b.file_size, b.modified_at, b.page_count,
                        b.cover_page_index, b.cover_cache_key, b.is_favorite, b.rating, b.status,
                        b.imported_at, b.updated_at, b.last_read_at, coalesce(rp.percent, 0)
                 FROM books b
                 LEFT JOIN reading_progress rp ON rp.book_id = b.id
                 WHERE b.id = ?1",
                params![id],
                |row| self.map_book_row(row),
            )
            .map_err(Into::into)
    }

    pub fn get_book_by_path(&self, path: &Path) -> Result<Option<Book>> {
        self.conn
            .query_row(
                "SELECT b.id, b.library_id, b.series_id, b.title, b.sort_title, b.author, b.volume,
                        b.chapter, b.path, b.format, b.file_size, b.modified_at, b.page_count,
                        b.cover_page_index, b.cover_cache_key, b.is_favorite, b.rating, b.status,
                        b.imported_at, b.updated_at, b.last_read_at, coalesce(rp.percent, 0)
                 FROM books b
                 LEFT JOIN reading_progress rp ON rp.book_id = b.id
                 WHERE b.path = ?1 AND b.status = 'available'",
                params![path.to_string_lossy().to_string()],
                |row| self.map_book_row(row),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn books_for_external_matching(&self) -> Result<Vec<ExternalMatchBook>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, path FROM books WHERE status = 'available' ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ExternalMatchBook {
                id: row.get(0)?,
                title: row.get(1)?,
                path: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn import_external_identities(
        &mut self,
        provider_id: &str,
        candidates: &[ExternalIdentityCandidate],
    ) -> Result<ExternalIdentityImportResult> {
        let tx = self.conn.transaction()?;
        let stamp = now();
        tx.execute(
            "INSERT OR IGNORE INTO metadata_sources(
                provider_id, name, enabled, priority, config_json, created_at, updated_at
             ) VALUES (?1, ?2, 0, 100, '{}', ?3, ?3)",
            params![provider_id, provider_id, stamp],
        )?;
        let source_id: i64 = tx.query_row(
            "SELECT id FROM metadata_sources WHERE provider_id=?1",
            params![provider_id],
            |row| row.get(0),
        )?;
        let mut result = ExternalIdentityImportResult {
            linked: 0,
            unchanged: 0,
            conflicts: 0,
            skipped: 0,
        };
        for candidate in candidates {
            if candidate.remote_id.trim().is_empty() {
                result.skipped += 1;
                continue;
            }
            let remote_book = tx
                .query_row(
                    "SELECT book_id FROM external_book_ids
                     WHERE provider_id=?1 AND remote_id=?2",
                    params![provider_id, candidate.remote_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let book_remote = tx
                .query_row(
                    "SELECT remote_id FROM external_book_ids
                     WHERE provider_id=?1 AND book_id=?2",
                    params![provider_id, candidate.book_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if remote_book == Some(candidate.book_id)
                && book_remote.as_deref() == Some(candidate.remote_id.as_str())
            {
                tx.execute(
                    "UPDATE external_book_ids
                     SET canonical_source_path=?1, updated_at=?2
                     WHERE provider_id=?3 AND book_id=?4",
                    params![
                        candidate.canonical_source_path,
                        stamp,
                        provider_id,
                        candidate.book_id
                    ],
                )?;
                result.unchanged += 1;
                continue;
            }
            if remote_book.is_some() || book_remote.is_some() {
                result.conflicts += 1;
                continue;
            }
            tx.execute(
                "INSERT INTO external_book_ids(
                    book_id, provider_id, remote_id, match_method, match_confidence,
                    canonical_source_path, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'download_db_exact_path', 1.0, ?4, ?5, ?5)",
                params![
                    candidate.book_id,
                    provider_id,
                    candidate.remote_id,
                    candidate.canonical_source_path,
                    stamp
                ],
            )?;
            tx.execute(
                "INSERT INTO metadata_history(
                    book_id, source_id, field_name, old_value, new_value, created_at, updated_at
                 ) VALUES (?1, ?2, 'external_id:jmcomic', NULL, ?3, ?4, ?4)",
                params![candidate.book_id, source_id, candidate.remote_id, stamp],
            )?;
            result.linked += 1;
        }
        tx.commit()?;
        Ok(result)
    }

    pub fn external_identity_for_book(
        &self,
        book_id: i64,
        provider_id: &str,
    ) -> Result<Option<ExternalBookIdentity>> {
        self.conn
            .query_row(
                "SELECT book_id, provider_id, remote_id, match_method, match_confidence,
                        canonical_source_path, created_at, updated_at
                 FROM external_book_ids WHERE book_id=?1 AND provider_id=?2",
                params![book_id, provider_id],
                |row| {
                    Ok(ExternalBookIdentity {
                        book_id: row.get(0)?,
                        provider_id: row.get(1)?,
                        remote_id: row.get(2)?,
                        match_method: row.get(3)?,
                        match_confidence: row.get(4)?,
                        canonical_source_path: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn store_external_metadata(
        &mut self,
        metadata: &ExternalBookMetadata,
        payload_hash: &str,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        let stamp = now();
        let authors = serde_json::to_string(&metadata.authors)
            .map_err(|error| MangaVaultError::Message(error.to_string()))?;
        let categories = serde_json::to_string(&metadata.categories)
            .map_err(|error| MangaVaultError::Message(error.to_string()))?;
        let chapters = serde_json::to_string(&metadata.chapters)
            .map_err(|error| MangaVaultError::Message(error.to_string()))?;
        tx.execute(
            "INSERT INTO external_book_metadata(
                book_id, provider_id, remote_id, original_title, authors_json,
                categories_json, description, chapters_json, remote_cover_url, payload_hash,
                fetched_at, expires_at, status, error_message, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(book_id, provider_id) DO UPDATE SET
                remote_id=excluded.remote_id,
                original_title=excluded.original_title,
                authors_json=excluded.authors_json,
                categories_json=excluded.categories_json,
                description=excluded.description,
                chapters_json=excluded.chapters_json,
                remote_cover_url=excluded.remote_cover_url,
                payload_hash=excluded.payload_hash,
                fetched_at=excluded.fetched_at,
                expires_at=excluded.expires_at,
                status=excluded.status,
                error_message=excluded.error_message,
                updated_at=excluded.updated_at",
            params![
                metadata.book_id,
                metadata.provider_id,
                metadata.remote_id,
                metadata.original_title,
                authors,
                categories,
                metadata.description,
                chapters,
                metadata.remote_cover_url,
                payload_hash,
                metadata.fetched_at,
                metadata.expires_at,
                metadata.status,
                metadata.error_message,
                stamp
            ],
        )?;
        tx.execute(
            "DELETE FROM external_book_tags WHERE book_id=?1 AND provider_id=?2",
            params![metadata.book_id, metadata.provider_id],
        )?;
        let mut seen = HashSet::new();
        for source_tag in &metadata.tags {
            let normalized = normalize_external_tag(source_tag);
            if normalized.is_empty() || !seen.insert(normalized.clone()) {
                continue;
            }
            tx.execute(
                "INSERT INTO external_book_tags(
                    book_id, provider_id, normalized_tag, source_tag, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    metadata.book_id,
                    metadata.provider_id,
                    normalized,
                    source_tag.trim(),
                    stamp
                ],
            )?;
        }
        tx.execute(
            "DELETE FROM external_book_categories WHERE book_id=?1 AND provider_id=?2",
            params![metadata.book_id, metadata.provider_id],
        )?;
        let mut seen_categories = HashSet::new();
        for source_category in &metadata.categories {
            let normalized = normalize_external_tag(source_category);
            if normalized.is_empty() || !seen_categories.insert(normalized.clone()) {
                continue;
            }
            tx.execute(
                "INSERT INTO external_book_categories(
                    book_id, provider_id, normalized_category, source_category, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    metadata.book_id,
                    metadata.provider_id,
                    normalized,
                    source_category.trim(),
                    stamp
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn external_metadata_for_book(
        &self,
        book_id: i64,
        provider_id: &str,
    ) -> Result<Option<ExternalBookMetadata>> {
        let row = self
            .conn
            .query_row(
                "SELECT book_id, provider_id, remote_id, original_title, authors_json,
                        categories_json, description, chapters_json, remote_cover_url,
                        fetched_at, expires_at, status, error_message
                 FROM external_book_metadata WHERE book_id=?1 AND provider_id=?2",
                params![book_id, provider_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, String>(11)?,
                        row.get::<_, Option<String>>(12)?,
                    ))
                },
            )
            .optional()?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(ExternalBookMetadata {
            book_id: row.0,
            provider_id: row.1,
            remote_id: row.2,
            original_title: row.3,
            authors: parse_json_array(&row.4),
            categories: self.external_categories_for_book(book_id, provider_id)?,
            tags: self.external_tags_for_book(book_id, provider_id)?,
            description: row.6,
            chapters: serde_json::from_str(&row.7).unwrap_or_default(),
            remote_cover_url: row.8,
            fetched_at: row.9,
            expires_at: row.10,
            status: row.11,
            error_message: row.12,
        }))
    }

    pub fn metadata_merge_preview(
        &self,
        book_id: i64,
        provider_id: &str,
    ) -> Result<Option<MetadataMergePreview>> {
        let Some(metadata) = self.external_metadata_for_book(book_id, provider_id)? else {
            return Ok(None);
        };
        let book = self.get_book(book_id)?;
        let source_author = metadata.authors.join(", ");
        let fields = vec![
            self.metadata_field_diff(
                book_id,
                "title",
                Some(book.title),
                metadata.original_title.clone(),
                false,
            )?,
            self.metadata_field_diff(
                book_id,
                "author",
                book.author,
                (!source_author.is_empty()).then_some(source_author),
                true,
            )?,
        ];
        Ok(Some(MetadataMergePreview {
            book_id,
            provider_id: provider_id.to_string(),
            remote_id: metadata.remote_id,
            fields,
            source_tags: metadata.tags,
            cached_at: metadata.fetched_at,
        }))
    }

    pub fn jmcomic_book_source(&self, book_id: i64) -> Result<Option<JmComicBookSource>> {
        let Some(identity) = self.external_identity_for_book(book_id, "jmcomic")? else {
            return Ok(None);
        };
        Ok(Some(JmComicBookSource {
            identity,
            metadata: self.external_metadata_for_book(book_id, "jmcomic")?,
            merge_preview: self.metadata_merge_preview(book_id, "jmcomic")?,
        }))
    }

    fn metadata_field_diff(
        &self,
        book_id: i64,
        field_name: &str,
        current_value: Option<String>,
        provider_value: Option<String>,
        select_when_empty: bool,
    ) -> Result<MetadataFieldDiff> {
        let manually_edited = self.conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM metadata_history
                WHERE book_id=?1 AND source_id IS NULL AND field_name=?2
             )",
            params![book_id, field_name],
            |row| row.get::<_, bool>(0),
        )?;
        let default_selected = !manually_edited
            && provider_value
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
            && select_when_empty
            && current_value
                .as_deref()
                .map_or(true, |value| value.trim().is_empty());
        Ok(MetadataFieldDiff {
            field_name: field_name.to_string(),
            current_value,
            provider_value,
            manually_edited,
            default_selected,
        })
    }

    fn external_tags_for_book(&self, book_id: i64, provider_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_tag FROM external_book_tags
             WHERE book_id=?1 AND provider_id=?2 ORDER BY source_tag COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![book_id, provider_id], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    fn external_categories_for_book(&self, book_id: i64, provider_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_category FROM external_book_categories
             WHERE book_id=?1 AND provider_id=?2 ORDER BY source_category COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![book_id, provider_id], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn create_metadata_job(
        &self,
        provider_id: &str,
        book_id: i64,
        remote_id: &str,
        requested_by: &str,
    ) -> Result<MetadataJobRecord> {
        let stamp = now();
        self.conn.execute(
            "INSERT INTO metadata_jobs(
                provider_id, book_id, remote_id, status, requested_by, attempts,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'queued', ?4, 0, ?5, ?5)",
            params![provider_id, book_id, remote_id, requested_by, stamp],
        )?;
        self.metadata_job(self.conn.last_insert_rowid())
    }

    pub fn update_metadata_job(
        &self,
        id: i64,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<MetadataJobRecord> {
        if !matches!(status, "running" | "succeeded" | "failed" | "cancelled") {
            return Err(MangaVaultError::Message(
                "invalid metadata job status".to_string(),
            ));
        }
        let stamp = now();
        self.conn.execute(
            "UPDATE metadata_jobs SET
                status=?1,
                attempts=attempts + CASE WHEN ?1='running' THEN 1 ELSE 0 END,
                error_message=?2,
                started_at=CASE WHEN ?1='running' THEN coalesce(started_at, ?3) ELSE started_at END,
                finished_at=CASE WHEN ?1 IN ('succeeded','failed','cancelled') THEN ?3 ELSE NULL END,
                updated_at=?3
             WHERE id=?4",
            params![status, error_message, stamp, id],
        )?;
        self.metadata_job(id)
    }

    pub fn metadata_job(&self, id: i64) -> Result<MetadataJobRecord> {
        self.conn
            .query_row(
                "SELECT id, provider_id, book_id, remote_id, status, requested_by, attempts,
                        error_message, created_at, started_at, finished_at, updated_at
                 FROM metadata_jobs WHERE id=?1",
                params![id],
                map_metadata_job,
            )
            .map_err(Into::into)
    }

    pub fn recent_metadata_jobs(
        &self,
        provider_id: &str,
        limit: i64,
    ) -> Result<Vec<MetadataJobRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, provider_id, book_id, remote_id, status, requested_by, attempts,
                    error_message, created_at, started_at, finished_at, updated_at
             FROM metadata_jobs WHERE provider_id=?1
             ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![provider_id, limit.clamp(1, 200)], map_metadata_job)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn metadata_provider_counts(&self, provider_id: &str) -> Result<(i64, i64, i64, i64)> {
        self.conn
            .query_row(
                "SELECT
                    (SELECT count(*) FROM external_book_ids WHERE provider_id=?1),
                    (SELECT count(*) FROM external_book_metadata WHERE provider_id=?1),
                    (SELECT count(*) FROM metadata_jobs WHERE provider_id=?1 AND status='queued'),
                    (SELECT count(*) FROM metadata_jobs WHERE provider_id=?1 AND status='running')",
                params![provider_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(Into::into)
    }

    pub fn external_identities(&self, provider_id: &str) -> Result<Vec<ExternalBookIdentity>> {
        let mut stmt = self.conn.prepare(
            "SELECT book_id, provider_id, remote_id, match_method, match_confidence,
                    canonical_source_path, created_at, updated_at
             FROM external_book_ids WHERE provider_id=?1 ORDER BY book_id ASC",
        )?;
        let rows = stmt.query_map(params![provider_id], |row| {
            Ok(ExternalBookIdentity {
                book_id: row.get(0)?,
                provider_id: row.get(1)?,
                remote_id: row.get(2)?,
                match_method: row.get(3)?,
                match_confidence: row.get(4)?,
                canonical_source_path: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn update_book_metadata(&self, id: i64, update: MetadataUpdate) -> Result<Book> {
        let stamp = now();
        let sort_title = normalize_sort_title(&update.title);
        let previous = self.conn.query_row(
            "SELECT title, author, volume, chapter FROM books WHERE id=?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<f64>>(2)?,
                    row.get::<_, Option<f64>>(3)?,
                ))
            },
        )?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE books SET title=?1, sort_title=?2, author=?3, volume=?4, chapter=?5, updated_at=?6 WHERE id=?7",
            params![
                update.title,
                sort_title,
                update.author,
                update.volume,
                update.chapter,
                stamp,
                id
            ],
        )?;
        let changes = [
            ("title", Some(previous.0), Some(update.title)),
            ("author", previous.1, update.author),
            (
                "volume",
                previous.2.map(|value| value.to_string()),
                update.volume.map(|value| value.to_string()),
            ),
            (
                "chapter",
                previous.3.map(|value| value.to_string()),
                update.chapter.map(|value| value.to_string()),
            ),
        ];
        for (field_name, old_value, new_value) in changes {
            if old_value == new_value {
                continue;
            }
            tx.execute(
                "INSERT INTO metadata_history(book_id, source_id, field_name, old_value, new_value, created_at, updated_at)
                 VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?5)",
                params![id, field_name, old_value, new_value, stamp],
            )?;
        }
        tx.commit()?;
        self.get_book(id)
    }

    pub fn toggle_favorite(&self, id: i64) -> Result<Book> {
        self.conn.execute(
            "UPDATE books SET is_favorite = CASE is_favorite WHEN 1 THEN 0 ELSE 1 END, updated_at=?1 WHERE id=?2",
            params![now(), id],
        )?;
        self.get_book(id)
    }

    pub fn set_rating(&self, id: i64, rating: i64) -> Result<Book> {
        self.conn.execute(
            "UPDATE books SET rating=?1, updated_at=?2 WHERE id=?3",
            params![rating.clamp(0, 5), now(), id],
        )?;
        self.get_book(id)
    }

    pub fn list_tags(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT value FROM (
               SELECT name AS value FROM tags
               UNION
               SELECT source_tag AS value FROM external_book_tags
             ) ORDER BY value COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_categories(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT source_category FROM external_book_categories
             ORDER BY source_category COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_authors(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT author
             FROM books
             WHERE status != 'deleted'
               AND author IS NOT NULL
               AND trim(author) != ''
             ORDER BY author COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_formats(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT format
             FROM books
             WHERE status != 'deleted' AND trim(format) != ''
             ORDER BY format COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn set_book_tags(&mut self, book_id: i64, tags: Vec<String>) -> Result<Vec<String>> {
        let tx = self.conn.transaction()?;
        let stamp = now();
        tx.execute("DELETE FROM book_tags WHERE book_id=?1", params![book_id])?;
        for tag in tags.iter().map(|v| v.trim()).filter(|v| !v.is_empty()) {
            tx.execute(
                "INSERT OR IGNORE INTO tags(name, color, created_at) VALUES (?1, '#64748b', ?2)",
                params![tag, stamp],
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO book_tags(book_id, tag_id, created_at)
                 SELECT ?1, id, ?2 FROM tags WHERE name=?3",
                params![book_id, stamp, tag],
            )?;
        }
        tx.commit()?;
        self.tags_for_book(book_id)
    }

    pub fn pages_for_book(&self, book_id: i64) -> Result<Vec<BookPage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, book_id, page_index, source_path, width, height, byte_size
             FROM pages WHERE book_id=?1 ORDER BY page_index ASC",
        )?;
        let rows = stmt.query_map(params![book_id], map_book_page)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn page_for_book(&self, book_id: i64, page_index: i64) -> Result<Option<BookPage>> {
        self.conn
            .query_row(
                "SELECT id, book_id, page_index, source_path, width, height, byte_size
                 FROM pages WHERE book_id=?1 AND page_index=?2",
                params![book_id, page_index],
                map_book_page,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn page_source_for_book(
        &self,
        book_id: i64,
        page_index: i64,
    ) -> Result<Option<PageSource>> {
        self.conn
            .query_row(
                "SELECT b.path, b.updated_at, p.source_path
                 FROM pages p
                 JOIN books b ON b.id = p.book_id
                 WHERE p.book_id = ?1 AND p.page_index = ?2 AND b.status != 'deleted'",
                params![book_id, page_index],
                |row| {
                    Ok(PageSource {
                        book_path: row.get(0)?,
                        book_updated_at: row.get(1)?,
                        source_path: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn chapters_for_book(&self, book_id: i64) -> Result<Vec<Chapter>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, book_id, title, chapter_number, start_page, page_count, created_at
             FROM chapters WHERE book_id=?1 ORDER BY start_page ASC, chapter_number ASC",
        )?;
        let rows = stmt.query_map(params![book_id], |row| {
            Ok(Chapter {
                id: row.get(0)?,
                book_id: row.get(1)?,
                title: row.get(2)?,
                chapter_number: row.get(3)?,
                start_page: row.get(4)?,
                page_count: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn find_thumbnail_path(
        &self,
        book_id: i64,
        page_index: i64,
        cache_key: &str,
    ) -> Result<Option<PathBuf>> {
        let path = self
            .conn
            .query_row(
                "SELECT disk_path FROM thumbnails WHERE book_id=?1 AND page_index=?2 AND cache_key=?3",
                params![book_id, page_index, cache_key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map(|value| value.map(PathBuf::from))
            ?;
        let Some(path) = path else {
            return Ok(None);
        };
        if !path.is_file() {
            self.conn.execute(
                "DELETE FROM thumbnails WHERE book_id=?1 AND page_index=?2 AND cache_key=?3",
                params![book_id, page_index, cache_key],
            )?;
            return Ok(None);
        }
        self.conn.execute(
            "UPDATE thumbnails SET last_accessed_at=?4 WHERE book_id=?1 AND page_index=?2 AND cache_key=?3",
            params![book_id, page_index, cache_key, now()],
        )?;
        Ok(Some(path))
    }

    pub fn delete_thumbnail_records_by_paths(&self, paths: &[PathBuf]) -> Result<usize> {
        if paths.is_empty() {
            return Ok(0);
        }
        let transaction = self.conn.unchecked_transaction()?;
        let mut deleted = 0;
        for path in paths {
            deleted += transaction.execute(
                "DELETE FROM thumbnails WHERE disk_path=?1",
                params![path.to_string_lossy().to_string()],
            )?;
        }
        transaction.commit()?;
        Ok(deleted)
    }

    pub fn upsert_thumbnail(&self, thumbnail: ThumbnailRecord<'_>) -> Result<()> {
        let stamp = now();
        self.conn.execute(
            "INSERT INTO thumbnails(book_id, page_index, cache_key, disk_path, width, height, byte_size, created_at, last_accessed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(cache_key) DO UPDATE SET
               disk_path=excluded.disk_path,
               width=excluded.width,
               height=excluded.height,
               byte_size=excluded.byte_size,
               last_accessed_at=excluded.last_accessed_at",
            params![
                thumbnail.book_id,
                thumbnail.page_index,
                thumbnail.cache_key,
                thumbnail.disk_path.to_string_lossy().to_string(),
                thumbnail.width,
                thumbnail.height,
                thumbnail.byte_size,
                stamp
            ],
        )?;
        Ok(())
    }

    pub fn save_progress(
        &self,
        book_id: i64,
        current_page: i64,
        total_pages: i64,
        mode: String,
        direction: String,
    ) -> Result<ReadingProgress> {
        let stamp = now();
        let percent = if total_pages <= 0 {
            0.0
        } else {
            ((current_page + 1) as f64 / total_pages as f64).clamp(0.0, 1.0)
        };
        self.conn.execute(
            "INSERT INTO reading_progress(book_id, current_page, total_pages, percent, mode, direction, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(book_id) DO UPDATE SET
               current_page=excluded.current_page,
               total_pages=excluded.total_pages,
               percent=excluded.percent,
               mode=excluded.mode,
               direction=excluded.direction,
               updated_at=excluded.updated_at",
            params![book_id, current_page, total_pages, percent, mode, direction, stamp],
        )?;
        self.conn.execute(
            "UPDATE books SET last_read_at=?1 WHERE id=?2",
            params![stamp, book_id],
        )?;
        let updated = self.conn.execute(
            "UPDATE reading_history
             SET page_index=?1, opened_at=?2
             WHERE id=(
                SELECT id FROM reading_history WHERE book_id=?3 ORDER BY opened_at DESC, id DESC LIMIT 1
             )",
            params![current_page, stamp, book_id],
        )?;
        if updated == 0 {
            self.conn.execute(
                "INSERT INTO reading_history(book_id, page_index, opened_at) VALUES (?1, ?2, ?3)",
                params![book_id, current_page, stamp],
            )?;
        }
        self.get_progress(book_id)?.ok_or_else(|| {
            crate::error::MangaVaultError::Message("failed to save reading progress".to_string())
        })
    }

    pub fn record_reading_opened(&self, book_id: i64, page_index: i64) -> Result<()> {
        let stamp = now();
        self.conn.execute(
            "UPDATE books SET last_read_at=?1 WHERE id=?2",
            params![stamp, book_id],
        )?;
        self.conn.execute(
            "INSERT INTO reading_history(book_id, page_index, opened_at) VALUES (?1, ?2, ?3)",
            params![book_id, page_index, stamp],
        )?;
        Ok(())
    }

    pub fn get_progress(&self, book_id: i64) -> Result<Option<ReadingProgress>> {
        self.conn
            .query_row(
                "SELECT book_id, current_page, total_pages, percent, mode, direction, updated_at
                 FROM reading_progress WHERE book_id=?1",
                params![book_id],
                map_progress,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn add_bookmark(
        &self,
        book_id: i64,
        page_index: i64,
        note: Option<String>,
    ) -> Result<Bookmark> {
        let stamp = now();
        self.conn.execute(
            "INSERT INTO bookmarks(book_id, page_index, note, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(book_id, page_index) DO UPDATE SET note=excluded.note",
            params![book_id, page_index, note, stamp],
        )?;
        self.conn
            .query_row(
                "SELECT id, book_id, page_index, note, created_at FROM bookmarks WHERE book_id=?1 AND page_index=?2",
                params![book_id, page_index],
                map_bookmark,
            )
            .map_err(Into::into)
    }

    pub fn remove_bookmark(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM bookmarks WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn list_bookmarks(&self, book_id: i64) -> Result<Vec<Bookmark>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, book_id, page_index, note, created_at
             FROM bookmarks WHERE book_id=?1 ORDER BY page_index ASC",
        )?;
        let rows = stmt.query_map(params![book_id], map_bookmark)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_history(&self) -> Result<Vec<ReadingHistoryItem>> {
        let mut stmt = self.conn.prepare(
            "WITH latest_history AS (
                SELECT h.id, h.book_id, h.page_index, h.opened_at,
                       ROW_NUMBER() OVER (
                         PARTITION BY h.book_id ORDER BY h.opened_at DESC, h.id DESC
                       ) AS position
                FROM reading_history h
             )
             SELECT h.book_id, b.title, h.page_index, b.page_count, h.opened_at, b.path
             FROM latest_history h
             JOIN books b ON b.id = h.book_id
             WHERE h.position = 1
             ORDER BY h.opened_at DESC, h.id DESC
             LIMIT 200",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ReadingHistoryItem {
                book_id: row.get(0)?,
                title: row.get(1)?,
                page_index: row.get(2)?,
                total_pages: row.get(3)?,
                opened_at: row.get(4)?,
                path: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn clear_reading_history(&self) -> Result<usize> {
        Ok(self.conn.execute("DELETE FROM reading_history", [])?)
    }

    pub fn list_recent_reading(&self, query: RecentReadingQuery) -> Result<RecentReadingPage> {
        let limit = query.limit.unwrap_or(80).clamp(1, 200);
        let offset = query.offset.unwrap_or(0).max(0);
        let search = query.search.unwrap_or_default().trim().to_string();
        let filter = query.filter.as_deref().unwrap_or("all");
        let sort = query.sort.as_deref().unwrap_or("recent");
        let cutoff = recent_reading_cutoff(filter, query.timezone_offset_minutes);
        let progress_sql = "CASE
            WHEN rp.percent IS NOT NULL THEN rp.percent
            WHEN b.page_count > 0 THEN min(1.0, CAST(h.page_index + 1 AS REAL) / b.page_count)
            ELSE 0.0
        END";
        let like = if search.is_empty() {
            None
        } else {
            Some(format!("%{}%", escape_like(&search)))
        };

        let mut where_clauses = vec!["b.status <> 'deleted'".to_string()];
        let mut args: Vec<Box<dyn ToSql>> = Vec::new();
        if let Some(pattern) = like {
            where_clauses.push(
                "(b.title LIKE ? ESCAPE '\\' OR coalesce(b.author, '') LIKE ? ESCAPE '\\')"
                    .to_string(),
            );
            args.push(Box::new(pattern.clone()));
            args.push(Box::new(pattern));
        }
        match filter {
            "unfinished" => where_clauses.push(format!("{progress_sql} < 0.999")),
            "finished" => where_clauses.push(format!("{progress_sql} >= 0.999")),
            _ => {}
        }
        if let Some(cutoff) = cutoff {
            where_clauses.push("h.opened_at >= ?".to_string());
            args.push(Box::new(cutoff));
        }
        let where_sql = where_clauses.join(" AND ");
        let order_sql = match sort {
            "progress" => {
                "CASE WHEN rp.percent IS NOT NULL THEN rp.percent WHEN b.page_count > 0 THEN min(1.0, CAST(h.page_index + 1 AS REAL) / b.page_count) ELSE 0.0 END DESC, h.opened_at DESC, h.id DESC"
            }
            "title" => "b.sort_title COLLATE NOCASE ASC, h.opened_at DESC, h.id DESC",
            _ => "h.opened_at DESC, h.id DESC",
        };
        let cte = "WITH latest_history AS (
             SELECT h.id, h.book_id, h.page_index, h.opened_at,
                    ROW_NUMBER() OVER (
                      PARTITION BY h.book_id ORDER BY h.opened_at DESC, h.id DESC
                    ) AS position
             FROM reading_history h
           )";
        let count_sql = format!(
            "{cte}
             SELECT COUNT(*)
             FROM latest_history h
             JOIN books b ON b.id=h.book_id
             LEFT JOIN reading_progress rp ON rp.book_id=b.id
             WHERE h.position=1 AND {where_sql}"
        );
        let total = self.conn.query_row(
            &count_sql,
            rusqlite::params_from_iter(args.iter().map(|value| &**value)),
            |row| row.get(0),
        )?;

        let page_sql = format!(
            "{cte}
             SELECT h.book_id, h.page_index, h.opened_at,
                    coalesce(rp.current_page, h.page_index),
                    CASE WHEN coalesce(rp.total_pages, 0) > 0 THEN rp.total_pages ELSE b.page_count END,
                      {progress_sql}
             FROM latest_history h
             JOIN books b ON b.id=h.book_id
             LEFT JOIN reading_progress rp ON rp.book_id=b.id
             WHERE h.position=1 AND {where_sql}
             ORDER BY {order_sql}
             LIMIT ? OFFSET ?"
        );
        args.push(Box::new(limit));
        args.push(Box::new(offset));
        let mut stmt = self.conn.prepare(&page_sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(args.iter().map(|value| &**value)),
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, f64>(5)?,
                ))
            },
        )?;
        let summaries = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(crate::error::MangaVaultError::from)?;
        let mut items = Vec::with_capacity(summaries.len());
        for (book_id, current_page, last_read_at, total_pages, percent) in summaries {
            let book = self.get_book(book_id)?;
            items.push(RecentReadingItem {
                book,
                current_page,
                total_pages,
                progress_percent: percent.clamp(0.0, 1.0),
                last_read_at,
                is_finished: total_pages > 0
                    && (percent >= 0.999 || current_page >= total_pages.saturating_sub(1)),
            });
        }
        Ok(RecentReadingPage {
            items,
            total,
            offset,
            limit,
        })
    }

    pub fn remove_recent_reading(&self, book_id: i64) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM reading_history WHERE book_id=?1",
            params![book_id],
        )?)
    }

    pub fn reset_reading_progress(&self, book_id: i64) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM reading_progress WHERE book_id=?1",
            params![book_id],
        )?;
        tx.execute(
            "UPDATE reading_history SET page_index=0 WHERE book_id=?1",
            params![book_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn mark_book_read(&self, book_id: i64) -> Result<ReadingProgress> {
        let total_pages = self
            .conn
            .query_row(
                "SELECT page_count FROM books WHERE id=?1 AND status <> 'deleted'",
                params![book_id],
                |row| row.get::<_, i64>(0),
            )?
            .max(1);
        let (mode, direction) = self
            .get_progress(book_id)?
            .map(|progress| (progress.mode, progress.direction))
            .unwrap_or_else(|| ("single".to_string(), "ltr".to_string()));
        self.save_progress(book_id, total_pages - 1, total_pages, mode, direction)
    }

    pub fn list_reader_profiles(&self) -> Result<Vec<ReaderProfileRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, profile_id, name, mode, direction, fit, settings_json, created_at, updated_at
             FROM reader_profiles ORDER BY name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let raw: String = row.get(6)?;
            let settings =
                serde_json::from_str(&raw).unwrap_or(serde_json::Value::Object(Default::default()));
            Ok(ReaderProfileRecord {
                id: row.get(0)?,
                profile_id: row.get(1)?,
                name: row.get(2)?,
                mode: row.get(3)?,
                direction: row.get(4)?,
                fit: row.get(5)?,
                settings,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn reader_settings_scope_counts(&self) -> Result<ReaderSettingsScopeCounts> {
        let book_settings =
            self.conn
                .query_row("SELECT count(*) FROM book_reader_settings", [], |row| {
                    row.get(0)
                })?;
        let series_settings =
            self.conn
                .query_row("SELECT count(*) FROM series_reader_settings", [], |row| {
                    row.get(0)
                })?;
        Ok(ReaderSettingsScopeCounts {
            book_settings,
            series_settings,
        })
    }

    pub fn list_smart_collections(&self) -> Result<Vec<SmartCollectionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, query_json, enabled, created_at, updated_at
             FROM smart_collections ORDER BY name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let raw: String = row.get(2)?;
            let query =
                serde_json::from_str(&raw).unwrap_or(serde_json::Value::Object(Default::default()));
            Ok(SmartCollectionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                query,
                enabled: row.get::<_, i64>(3)? == 1,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_upscale_cache_paths(&self) -> Result<Vec<PathBuf>> {
        let mut stmt = self
            .conn
            .prepare("SELECT output_path FROM upscale_cache ORDER BY last_accessed_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0).map(PathBuf::from))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn clear_upscale_cache_records(&self) -> Result<usize> {
        self.conn
            .execute("DELETE FROM upscale_cache", [])
            .map_err(Into::into)
    }

    pub fn list_feature_flags(&self) -> Result<Vec<FeatureFlagRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT key, enabled, created_at, updated_at
             FROM feature_flags ORDER BY key ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(FeatureFlagRecord {
                key: row.get(0)?,
                enabled: row.get::<_, i64>(1)? == 1,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_license_state(&self) -> Result<LicenseStateRecord> {
        self.conn
            .query_row(
                "SELECT license_key, status, metadata_json, created_at, updated_at
                 FROM license_state ORDER BY id ASC LIMIT 1",
                [],
                |row| {
                    let key: Option<String> = row.get(0)?;
                    let raw: String = row.get(2)?;
                    let metadata = serde_json::from_str(&raw)
                        .unwrap_or(serde_json::Value::Object(Default::default()));
                    Ok(LicenseStateRecord {
                        status: row.get(1)?,
                        license_key_present: key.as_deref().is_some_and(|value| !value.is_empty()),
                        metadata,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn list_telemetry_settings(&self) -> Result<Vec<TelemetrySettingRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT key, enabled, value, created_at, updated_at
             FROM telemetry_settings ORDER BY key ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let raw: String = row.get(2)?;
            let value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::String(raw));
            Ok(TelemetrySettingRecord {
                key: row.get(0)?,
                enabled: row.get::<_, i64>(1)? == 1,
                value,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn ocr_translation_status(&self) -> Result<OcrTranslationStatus> {
        let settings = self.get_settings()?;
        let ocr_cache_entries =
            self.conn
                .query_row("SELECT count(*) FROM ocr_cache", [], |row| row.get(0))?;
        let translation_cache_entries =
            self.conn
                .query_row("SELECT count(*) FROM translation_cache", [], |row| {
                    row.get(0)
                })?;
        Ok(OcrTranslationStatus {
            ocr_enabled: setting_bool(&settings, "features.ocr.enabled"),
            translation_enabled: setting_bool(&settings, "features.translation.enabled"),
            ocr_provider_id: setting_string_option(&settings, "ocr.provider_id"),
            translation_provider_id: setting_string_option(&settings, "translation.provider_id"),
            ocr_locale: setting_string(&settings, "ocr.default_locale", "ja"),
            source_locale: setting_string(&settings, "translation.source_locale", "ja"),
            target_locale: setting_string(&settings, "translation.target_locale", "zh-CN"),
            ocr_cache_entries,
            translation_cache_entries,
        })
    }

    pub fn sync_status(&self) -> Result<SyncStatusRecord> {
        let settings = self.get_settings()?;
        let configured_providers =
            self.conn
                .query_row("SELECT count(*) FROM sync_settings", [], |row| row.get(0))?;
        let log_entries = self
            .conn
            .query_row("SELECT count(*) FROM sync_log", [], |row| row.get(0))?;
        let last_sync_at =
            self.conn
                .query_row("SELECT max(last_sync_at) FROM sync_settings", [], |row| {
                    row.get(0)
                })?;
        Ok(SyncStatusRecord {
            enabled: setting_bool(&settings, "features.sync.enabled"),
            provider_id: setting_string_option(&settings, "sync.provider_id"),
            automatic_sync: setting_bool(&settings, "sync.automatic_enabled"),
            encryption_required: settings
                .get("sync.encryption_required")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true),
            conflict_strategy: setting_string(&settings, "sync.conflict_strategy", "manual"),
            configured_providers,
            log_entries,
            last_sync_at,
        })
    }

    pub fn plugin_status(&self) -> Result<PluginStatusRecord> {
        let settings = self.get_settings()?;
        let manifest_count =
            self.conn
                .query_row("SELECT count(*) FROM plugin_manifests", [], |row| {
                    row.get(0)
                })?;
        let enabled_manifest_count = self.conn.query_row(
            "SELECT count(*) FROM plugin_manifests WHERE enabled = 1",
            [],
            |row| row.get(0),
        )?;
        let settings_count =
            self.conn
                .query_row("SELECT count(*) FROM plugin_settings", [], |row| row.get(0))?;
        Ok(PluginStatusRecord {
            enabled: setting_bool(&settings, "features.plugins.enabled"),
            manifest_count,
            enabled_manifest_count,
            settings_count,
            dynamic_execution_enabled: false,
            plugin_directory: "plugins".to_string(),
            example_manifest_path: "plugins/examples/manifest.example.json".to_string(),
        })
    }

    pub fn get_settings(&self) -> Result<serde_json::Value> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM settings ORDER BY key ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map = serde_json::Map::new();
        for row in rows {
            let (key, raw) = row?;
            let value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::String(raw));
            map.insert(key, value);
        }
        Ok(serde_json::Value::Object(map))
    }

    pub fn locale(&self) -> Result<String> {
        let raw = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'locale'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(raw
            .and_then(|value| serde_json::from_str::<String>(&value).ok())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "zh-CN".to_string()))
    }

    pub fn set_setting(&self, key: String, value: serde_json::Value) -> Result<serde_json::Value> {
        let raw = serde_json::to_string(&value)
            .map_err(|err| crate::error::MangaVaultError::Message(err.to_string()))?;
        self.conn.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, raw, now()],
        )?;
        if key == "metadata.jmcomic.enabled" {
            self.conn.execute(
                "UPDATE metadata_sources SET enabled=?1, updated_at=?2 WHERE provider_id='jmcomic'",
                params![value.as_bool().unwrap_or(false), now()],
            )?;
        }
        self.get_settings()
    }

    pub fn reset_settings(&self) -> Result<serde_json::Value> {
        let existing_data_acknowledgement = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                params![EXISTING_DATA_NOTICE_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        self.conn.execute("DELETE FROM settings", [])?;
        self.seed_defaults()?;
        if let Some(raw) = existing_data_acknowledgement {
            self.conn.execute(
                "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![EXISTING_DATA_NOTICE_KEY, raw, now()],
            )?;
        }
        self.get_settings()
    }

    pub fn clear_thumbnail_records(&self) -> Result<usize> {
        Ok(self.conn.execute("DELETE FROM thumbnails", [])?)
    }

    fn setting_u64(&self, key: &str, fallback: u64) -> Result<u64> {
        let raw = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(raw
            .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
            .and_then(|value| {
                value
                    .as_u64()
                    .or_else(|| value.as_i64().map(|value| value.max(0) as u64))
            })
            .unwrap_or(fallback))
    }

    fn unchanged_scanned_book_id(&self, book: &ScannedBook) -> Result<Option<i64>> {
        let Some(existing) = self
            .conn
            .query_row(
                "SELECT id, library_id, format, file_size, modified_at, page_count, checksum
                 FROM books WHERE path = ?1",
                params![book.path],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, Option<String>>(6)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(None);
        };
        let (id, library_id, format, file_size, modified_at, page_count, checksum) = existing;
        let metadata_unchanged = library_id == book.library_id
            && format == book.format
            && file_size == book.file_size
            && modified_at == book.modified_at
            && page_count == book.page_count
            && checksum == book.checksum;
        if !metadata_unchanged || !self.pages_match_scanned_book(id, &book.pages)? {
            return Ok(None);
        }
        Ok(Some(id))
    }

    fn pages_match_scanned_book(&self, book_id: i64, pages: &[ScannedPage]) -> Result<bool> {
        let mut stmt = self.conn.prepare(
            "SELECT page_index, source_path, width, height, byte_size
             FROM pages WHERE book_id = ?1 ORDER BY page_index ASC",
        )?;
        let rows = stmt.query_map(params![book_id], |row| {
            Ok(ScannedPage {
                page_index: row.get(0)?,
                source_path: row.get(1)?,
                width: row.get(2)?,
                height: row.get(3)?,
                byte_size: row.get(4)?,
            })
        })?;
        let existing = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(crate::error::MangaVaultError::from)?;
        if existing.len() != pages.len() {
            return Ok(false);
        }
        Ok(existing.iter().zip(pages.iter()).all(|(left, right)| {
            left.page_index == right.page_index
                && left.source_path == right.source_path
                && left.width == right.width
                && left.height == right.height
                && left.byte_size == right.byte_size
        }))
    }

    fn tags_for_book(&self, book_id: i64) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.name FROM tags t JOIN book_tags bt ON bt.tag_id=t.id
             WHERE bt.book_id=?1 ORDER BY t.name ASC",
        )?;
        let rows = stmt.query_map(params![book_id], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    fn map_book_row(&self, row: &rusqlite::Row<'_>) -> rusqlite::Result<Book> {
        let id = row.get(0)?;
        let tags = self.tags_for_book(id).unwrap_or_default();
        Self::book_from_row(row, tags)
    }

    fn map_book_row_without_tags(row: &rusqlite::Row<'_>) -> rusqlite::Result<Book> {
        Self::book_from_row(row, Vec::new())
    }

    fn book_from_row(row: &rusqlite::Row<'_>, tags: Vec<String>) -> rusqlite::Result<Book> {
        Ok(Book {
            id: row.get(0)?,
            library_id: row.get(1)?,
            series_id: row.get(2)?,
            title: row.get(3)?,
            sort_title: row.get(4)?,
            author: row.get(5)?,
            volume: row.get(6)?,
            chapter: row.get(7)?,
            path: row.get(8)?,
            format: row.get(9)?,
            file_size: row.get(10)?,
            modified_at: row.get(11)?,
            page_count: row.get(12)?,
            cover_page_index: row.get(13)?,
            cover_cache_key: row.get(14)?,
            is_favorite: row.get::<_, i64>(15)? == 1,
            rating: row.get(16)?,
            status: row.get(17)?,
            imported_at: row.get(18)?,
            updated_at: row.get(19)?,
            last_read_at: row.get(20)?,
            progress_percent: row.get(21)?,
            tags,
        })
    }

    fn attach_tags_to_books(&self, books: &mut [Book]) -> Result<()> {
        if books.is_empty() {
            return Ok(());
        }
        let mut tags_by_book: HashMap<i64, Vec<String>> = HashMap::new();
        for chunk in books.chunks(900) {
            let ids = chunk.iter().map(|book| book.id).collect::<Vec<_>>();
            let placeholders = std::iter::repeat("?")
                .take(ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT bt.book_id, t.name
                 FROM book_tags bt
                 JOIN tags t ON t.id = bt.tag_id
                 WHERE bt.book_id IN ({placeholders})
                 ORDER BY bt.book_id ASC, t.name ASC"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (book_id, tag) = row?;
                tags_by_book.entry(book_id).or_default().push(tag);
            }
        }
        for book in books {
            book.tags = tags_by_book.remove(&book.id).unwrap_or_default();
        }
        Ok(())
    }

    fn pragma_i64(&self, name: &str) -> Result<i64> {
        self.conn
            .query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
            .map_err(Into::into)
    }
}

fn setting_bool(settings: &serde_json::Value, key: &str) -> bool {
    settings
        .get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn setting_string(settings: &serde_json::Value, key: &str, fallback: &str) -> String {
    setting_string_option(settings, key).unwrap_or_else(|| fallback.to_string())
}

fn setting_string_option(settings: &serde_json::Value, key: &str) -> Option<String> {
    settings
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}

pub fn now() -> String {
    Utc::now().to_rfc3339()
}

fn sqlite_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn database_snapshot_path(path: &Path, kind: &str) -> PathBuf {
    let now = Utc::now();
    let timestamp = format!(
        "{}{:09}",
        now.format("%Y%m%d%H%M%S"),
        now.timestamp_subsec_nanos()
    );
    path.with_extension(format!("{kind}-{timestamp}.sqlite3"))
}

fn pending_restore_path(path: &Path) -> PathBuf {
    path.with_extension("restore-pending.json")
}

fn pending_reset_path(path: &Path) -> PathBuf {
    path.with_extension("reset-pending.json")
}

fn managed_snapshot_path(database_path: &Path, snapshot_path: &Path) -> bool {
    let Ok(database_parent) = database_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .canonicalize()
    else {
        return false;
    };
    let Ok(snapshot_path) = snapshot_path.canonicalize() else {
        return false;
    };
    if !snapshot_path.starts_with(database_parent) || !snapshot_path.is_file() {
        return false;
    }
    let Some(database_stem) = database_path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(snapshot_name) = snapshot_path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    snapshot_name.starts_with(&format!("{database_stem}."))
        && snapshot_name.ends_with(".sqlite3")
        && snapshot_name
            != database_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
}

pub(crate) fn healthy_sqlite_file(path: &Path) -> bool {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|connection| {
            connection.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        })
        .map(|message| message == "ok")
        .unwrap_or(false)
}

fn read_pending_restore(path: &Path) -> Result<Option<PendingDatabaseRestore>> {
    let request_path = pending_restore_path(path);
    if !request_path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(request_path)?;
    let request = serde_json::from_str(&contents).map_err(|error| {
        MangaVaultError::Message(format!("invalid pending database restore request: {error}"))
    })?;
    Ok(Some(request))
}

fn write_pending_restore(path: &Path, request: &PendingDatabaseRestore) -> Result<()> {
    let request_path = pending_restore_path(path);
    let temporary = request_path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(request).map_err(|error| {
        MangaVaultError::Message(format!("could not serialize restore request: {error}"))
    })?;
    std::fs::write(&temporary, payload)?;
    if request_path.exists() {
        std::fs::remove_file(&request_path)?;
    }
    std::fs::rename(temporary, request_path)?;
    Ok(())
}

fn read_pending_reset(path: &Path) -> Result<Option<PendingDatabaseReset>> {
    let request_path = pending_reset_path(path);
    if !request_path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(request_path)?;
    let request = serde_json::from_str(&contents).map_err(|error| {
        MangaVaultError::Message(format!("invalid pending database reset request: {error}"))
    })?;
    Ok(Some(request))
}

fn write_pending_reset(path: &Path, request: &PendingDatabaseReset) -> Result<()> {
    let request_path = pending_reset_path(path);
    let temporary = request_path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(request).map_err(|error| {
        MangaVaultError::Message(format!(
            "could not serialize database reset request: {error}"
        ))
    })?;
    std::fs::write(&temporary, payload)?;
    if request_path.exists() {
        std::fs::remove_file(&request_path)?;
    }
    std::fs::rename(temporary, request_path)?;
    Ok(())
}

fn quarantine_pending_restore(path: &Path) -> Result<()> {
    let request_path = pending_restore_path(path);
    if !request_path.exists() {
        return Ok(());
    }
    let quarantined = path.with_extension(format!(
        "restore-failed-{}.json",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    std::fs::rename(request_path, quarantined)?;
    Ok(())
}

fn quarantine_pending_reset(path: &Path) -> Result<()> {
    let request_path = pending_reset_path(path);
    if !request_path.exists() {
        return Ok(());
    }
    let quarantined = path.with_extension(format!(
        "reset-failed-{}.json",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    std::fs::rename(request_path, quarantined)?;
    Ok(())
}

fn move_database_file(source: &Path, destination: &Path) -> Result<()> {
    match std::fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            std::fs::copy(source, destination).map_err(|copy_error| {
                MangaVaultError::Message(format!(
                    "could not move the replacement database ({rename_error}); copy also failed: {copy_error}"
                ))
            })?;
            std::fs::remove_file(source)?;
            Ok(())
        }
    }
}

fn snapshot_database_files(path: &Path, kind: &str) -> Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let snapshot_path = database_snapshot_path(path, kind);
    std::fs::copy(path, &snapshot_path)?;
    for suffix in ["-wal", "-shm"] {
        let source = PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix));
        if source.exists() {
            let destination =
                PathBuf::from(format!("{}{}", snapshot_path.to_string_lossy(), suffix));
            std::fs::copy(source, destination)?;
        }
    }
    Ok(Some(snapshot_path))
}

fn backup_corrupt_database_files(path: &Path) -> Result<PathBuf> {
    snapshot_database_files(path, "corrupt")?.ok_or_else(|| {
        MangaVaultError::Message(
            "database corruption recovery could not locate the database file".to_string(),
        )
    })
}

fn latest_healthy_backup(path: &Path) -> Option<PathBuf> {
    let parent = path.parent()?;
    let mut candidates = std::fs::read_dir(parent)
        .ok()?
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            (path.is_file() && name.contains(".backup-") && name.ends_with(".sqlite3"))
                .then_some(path)
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        let left_modified = std::fs::metadata(left)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let right_modified = std::fs::metadata(right)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        right_modified
            .cmp(&left_modified)
            .then_with(|| right.file_name().cmp(&left.file_name()))
    });
    candidates.into_iter().find(|candidate| {
        Database::open(candidate)
            .and_then(|database| database.health())
            .map(|health| health.ok)
            .unwrap_or(false)
    })
}

fn remove_database_files(path: &Path) -> Result<()> {
    for candidate in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", path.to_string_lossy())),
    ] {
        if candidate.exists() {
            std::fs::remove_file(candidate)?;
        }
    }
    Ok(())
}

pub fn normalize_sort_title(title: &str) -> String {
    let trimmed = title.trim();
    for prefix in ["the ", "a ", "an "] {
        if trimmed.to_lowercase().starts_with(prefix) {
            return trimmed[prefix.len()..].to_lowercase();
        }
    }
    trimmed.to_lowercase()
}

fn infer_scanned_chapters(book: &ScannedBook) -> Vec<ChapterSeed> {
    if book.pages.is_empty() {
        return vec![ChapterSeed {
            title: book.title.clone(),
            chapter_number: book.chapter,
            start_page: 0,
            page_count: 0,
        }];
    }

    let chapter_labels = book
        .pages
        .iter()
        .map(|page| chapter_label_from_source_path(&page.source_path))
        .collect::<Vec<_>>();
    if chapter_labels.iter().all(Option::is_none) {
        return vec![ChapterSeed {
            title: book.title.clone(),
            chapter_number: book.chapter,
            start_page: 0,
            page_count: book.pages.len() as i64,
        }];
    }

    let mut chapters = Vec::new();
    let mut current_title = String::new();
    let mut current_number = None;
    let mut current_start = 0_i64;
    let mut current_count = 0_i64;
    for (page, label) in book.pages.iter().zip(chapter_labels) {
        let title = label.unwrap_or_else(|| book.title.clone());
        if current_count == 0 {
            current_title = title;
            current_number = chapter_number_from_label(&current_title);
            current_start = page.page_index;
            current_count = 1;
            continue;
        }
        if title != current_title {
            chapters.push(ChapterSeed {
                title: current_title,
                chapter_number: current_number,
                start_page: current_start,
                page_count: current_count,
            });
            current_title = title;
            current_number = chapter_number_from_label(&current_title);
            current_start = page.page_index;
            current_count = 1;
        } else {
            current_count += 1;
        }
    }
    if current_count > 0 {
        chapters.push(ChapterSeed {
            title: current_title,
            chapter_number: current_number,
            start_page: current_start,
            page_count: current_count,
        });
    }
    chapters
}

fn chapter_label_from_source_path(source_path: &str) -> Option<String> {
    source_path
        .split(['/', '\\'])
        .rev()
        .skip(1)
        .find(|segment| looks_like_chapter_label(segment))
        .map(ToOwned::to_owned)
}

fn looks_like_chapter_label(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    lower.starts_with("chapter ")
        || lower.starts_with("chapter_")
        || lower.starts_with("chapter-")
        || lower.starts_with("ch ")
        || lower.starts_with("ch_")
        || lower.starts_with("ch-")
        || lower.starts_with("ep ")
        || lower.starts_with("ep_")
        || lower.starts_with("ep-")
        || (segment.starts_with('第')
            && (segment.contains('话')
                || segment.contains('話')
                || segment.contains('章')
                || segment.contains('回')))
}

fn chapter_number_from_label(label: &str) -> Option<f64> {
    let mut digits = String::new();
    let mut seen_digit = false;
    for ch in label.chars() {
        if ch.is_ascii_digit() || (ch == '.' && seen_digit) {
            digits.push(ch);
            seen_digit = true;
        } else if seen_digit {
            break;
        }
    }
    digits.parse::<f64>().ok()
}

fn escape_fts(input: &str) -> String {
    input
        .split_whitespace()
        .map(|part| part.replace('"', ""))
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_fts_prefix_query(input: &str) -> bool {
    input
        .chars()
        .all(|character| character.is_alphanumeric() || character.is_whitespace())
        && !input.trim().is_empty()
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn recent_reading_cutoff(filter: &str, timezone_offset_minutes: Option<i32>) -> Option<String> {
    let now = Utc::now();
    if filter == "today" {
        let offset = timezone_offset_minutes
            .unwrap_or(0)
            .clamp(-14 * 60, 14 * 60);
        let local_now = now - chrono::Duration::minutes(i64::from(offset));
        let local_midnight = local_now.date_naive().and_hms_opt(0, 0, 0)?;
        let utc_midnight = local_midnight + chrono::Duration::minutes(i64::from(offset));
        return Some(
            chrono::DateTime::<Utc>::from_naive_utc_and_offset(utc_midnight, Utc).to_rfc3339(),
        );
    }
    let days = match filter {
        "7days" => 7,
        "30days" => 30,
        _ => return None,
    };
    Some((now - chrono::Duration::days(days)).to_rfc3339())
}

fn map_library(row: &rusqlite::Row<'_>) -> rusqlite::Result<Library> {
    Ok(Library {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        recursive: row.get::<_, i64>(3)? == 1,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        last_scan_at: row.get(6)?,
        book_count: row.get(7)?,
    })
}

fn map_scan_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScanJob> {
    Ok(ScanJob {
        id: row.get(0)?,
        library_id: row.get(1)?,
        root_path: row.get(2)?,
        status: row.get(3)?,
        discovered_count: row.get(4)?,
        imported_count: row.get(5)?,
        failed_count: row.get(6)?,
        message: row.get(7)?,
        started_at: row.get(8)?,
        finished_at: row.get(9)?,
    })
}

fn map_book_page(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookPage> {
    Ok(BookPage {
        id: row.get(0)?,
        book_id: row.get(1)?,
        page_index: row.get(2)?,
        source_path: row.get(3)?,
        width: row.get(4)?,
        height: row.get(5)?,
        byte_size: row.get(6)?,
    })
}

fn map_progress(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReadingProgress> {
    Ok(ReadingProgress {
        book_id: row.get(0)?,
        current_page: row.get(1)?,
        total_pages: row.get(2)?,
        percent: row.get(3)?,
        mode: row.get(4)?,
        direction: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_bookmark(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bookmark> {
    Ok(Bookmark {
        id: row.get(0)?,
        book_id: row.get(1)?,
        page_index: row.get(2)?,
        note: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn map_metadata_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<MetadataJobRecord> {
    Ok(MetadataJobRecord {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        book_id: row.get(2)?,
        remote_id: row.get(3)?,
        status: row.get(4)?,
        requested_by: row.get(5)?,
        attempts: row.get(6)?,
        error_message: row.get(7)?,
        created_at: row.get(8)?,
        started_at: row.get(9)?,
        finished_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn parse_json_array(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn normalize_external_tag(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_sort_titles() {
        assert_eq!(normalize_sort_title("The Garden"), "garden");
        assert_eq!(normalize_sort_title("Volume 01"), "volume 01");
    }

    #[test]
    fn creates_database_with_seed_settings() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        let settings = db.get_settings().unwrap();
        assert_eq!(db.locale().unwrap(), "zh-CN");
        assert_eq!(settings["reader.mode"], "single");
        assert_eq!(settings["reader.zoom"], 100);
        assert_eq!(settings["reader.brightness"], 100);
        assert_eq!(settings["reader.trim_white"], false);
        assert_eq!(
            db.thumbnail_cache_limit_bytes().unwrap(),
            2048 * 1024 * 1024
        );
        assert_eq!(settings["features.ai.enabled"], false);
        assert_eq!(settings["features.sync.enabled"], false);
        assert_eq!(settings["sync.provider_id"], serde_json::Value::Null);
        assert_eq!(settings["sync.automatic_enabled"], false);
        assert_eq!(settings["sync.encryption_required"], true);
        assert_eq!(settings["sync.conflict_strategy"], "manual");
        assert_eq!(settings["features.ocr.enabled"], false);
        assert_eq!(settings["features.translation.enabled"], false);
        assert_eq!(settings["features.telemetry.enabled"], false);
        assert_eq!(settings["features.developer.enabled"], false);
        assert_eq!(settings["developer.command_debugger.enabled"], false);
        assert_eq!(settings["developer.profiler.enabled"], false);
        assert_eq!(settings["developer.database_browser.enabled"], false);
        assert_eq!(settings["upscale.enabled"], false);
        assert_eq!(settings["performance.low_memory"], false);
        assert_eq!(settings["performance.slow_query_log"], false);
        assert_eq!(settings["metadata.jmcomic.enabled"], false);
        db.set_setting(
            "metadata.jmcomic.enabled".to_string(),
            serde_json::Value::Bool(true),
        )
        .unwrap();
        assert!(db
            .conn
            .query_row(
                "SELECT enabled FROM metadata_sources WHERE provider_id='jmcomic'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap());
        assert_eq!(settings["ui.theme_preset_id"], "mangavault.dark");
        assert_eq!(settings["ui.layout.sidebar_mode"], "expanded");
        assert_eq!(settings["ui.layout.grid_density"], "comfortable");
        assert_eq!(settings["ui.command_palette.enabled"], true);
        assert_eq!(settings["ui.shortcuts.custom_enabled"], false);
        assert_eq!(settings["ocr.default_locale"], "ja");
        assert_eq!(settings["translation.target_locale"], "zh-CN");
        assert_eq!(settings["translation.overlay.enabled"], false);
        let profiles = db.list_reader_profiles().unwrap();
        assert!(profiles
            .iter()
            .any(|profile| profile.profile_id == "global.default"));
        assert!(profiles
            .iter()
            .any(|profile| profile.profile_id == "manga.rtl.double"));
        assert!(db
            .list_feature_flags()
            .unwrap()
            .iter()
            .all(|flag| !flag.enabled));
        assert!(db
            .list_telemetry_settings()
            .unwrap()
            .iter()
            .all(|setting| !setting.enabled));
        let license = db.get_license_state().unwrap();
        assert_eq!(license.status, "community");
        assert!(!license.license_key_present);
        let smart_collections = db.list_smart_collections().unwrap();
        assert!(smart_collections
            .iter()
            .any(|collection| collection.name == "收藏" && collection.enabled));
        let ocr_translation = db.ocr_translation_status().unwrap();
        assert!(!ocr_translation.ocr_enabled);
        assert!(!ocr_translation.translation_enabled);
        assert_eq!(ocr_translation.ocr_provider_id, None);
        assert_eq!(ocr_translation.translation_provider_id, None);
        assert_eq!(ocr_translation.ocr_cache_entries, 0);
        assert_eq!(ocr_translation.translation_cache_entries, 0);
        let sync = db.sync_status().unwrap();
        assert!(!sync.enabled);
        assert_eq!(sync.provider_id, None);
        assert!(!sync.automatic_sync);
        assert!(sync.encryption_required);
        assert_eq!(sync.conflict_strategy, "manual");
        assert_eq!(sync.configured_providers, 0);
        assert_eq!(sync.log_entries, 0);
        assert_eq!(sync.last_sync_at, None);
        let plugin_status = db.plugin_status().unwrap();
        assert!(!plugin_status.enabled);
        assert_eq!(plugin_status.manifest_count, 0);
        assert_eq!(plugin_status.enabled_manifest_count, 0);
        assert_eq!(plugin_status.settings_count, 0);
        assert!(!plugin_status.dynamic_execution_enabled);
        assert_eq!(
            plugin_status.example_manifest_path,
            "plugins/examples/manifest.example.json"
        );
    }

    #[test]
    fn records_schema_migration_versions() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let versions: Vec<i64> = db
            .conn
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|row| row.unwrap())
            .collect();
        assert_eq!(versions, vec![1, 3, 4, 5, 6, 7, 8, 9, 10]);
    }

    #[test]
    fn snapshots_a_legacy_database_before_upgrading_its_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite3");
        let db = Database::open(&path).unwrap();
        db.conn
            .execute_batch(
                "CREATE TABLE legacy_marker (value TEXT NOT NULL);
                 INSERT INTO legacy_marker(value) VALUES ('preserve me');",
            )
            .unwrap();

        let snapshot = db.migrate_and_seed_with_snapshot().unwrap().unwrap();

        assert!(snapshot.exists());
        assert_eq!(
            db.conn
                .query_row("SELECT value FROM legacy_marker", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "preserve me"
        );
        let reason: String = db
            .conn
            .query_row(
                "SELECT reason FROM backup_snapshots WHERE snapshot_path=?1",
                params![snapshot.to_string_lossy().to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(reason, "pre-migration");
    }

    #[test]
    fn failed_migration_rolls_back_schema_and_version_record() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let failing_migration = [(
            99,
            "CREATE TABLE failed_migration_marker (id INTEGER PRIMARY KEY);\n             INSERT INTO missing_table(value) VALUES ('fail');",
        )];

        assert!(db.apply_migrations(&failing_migration).is_err());
        assert!(!db.has_table("failed_migration_marker").unwrap());
        assert!(db
            .conn
            .query_row(
                "SELECT 1 FROM schema_migrations WHERE version=99",
                [],
                |_| Ok(()),
            )
            .optional()
            .unwrap()
            .is_none());
    }

    #[test]
    fn recovers_a_corrupt_database_file_on_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        std::fs::write(&path, b"not a sqlite database").unwrap();

        let (db, corrupt_backup) = Database::open_with_recovery(&path).unwrap();
        db.migrate().unwrap();

        assert!(corrupt_backup.unwrap().exists());
        assert!(db.health().unwrap().ok);
    }

    #[test]
    fn restores_a_scheduled_managed_snapshot_before_opening_the_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        let db = Database::open(&path).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        db.set_setting("restore.marker".to_string(), serde_json::json!("backup"))
            .unwrap();
        let snapshot = db.create_backup().unwrap();
        db.set_setting("restore.marker".to_string(), serde_json::json!("current"))
            .unwrap();
        db.schedule_database_restore(snapshot.to_string_lossy().to_string())
            .unwrap();
        assert!(pending_restore_path(&path).exists());
        drop(db);

        let safety_backup = Database::apply_pending_restore(&path).unwrap().unwrap();
        assert!(safety_backup.exists());
        assert!(!pending_restore_path(&path).exists());

        let restored = Database::open(&path).unwrap();
        assert_eq!(
            restored.get_settings().unwrap()["restore.marker"],
            serde_json::json!("backup")
        );
        assert!(healthy_sqlite_file(&safety_backup));
    }

    #[test]
    fn cancelling_a_scheduled_restore_keeps_the_current_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        let db = Database::open(&path).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        db.set_setting("restore.marker".to_string(), serde_json::json!("backup"))
            .unwrap();
        let snapshot = db.create_backup().unwrap();
        db.set_setting("restore.marker".to_string(), serde_json::json!("current"))
            .unwrap();
        db.schedule_database_restore(snapshot.to_string_lossy().to_string())
            .unwrap();
        db.cancel_database_restore().unwrap();
        drop(db);

        assert!(Database::apply_pending_restore(&path).unwrap().is_none());
        let current = Database::open(&path).unwrap();
        assert_eq!(
            current.get_settings().unwrap()["restore.marker"],
            serde_json::json!("current")
        );
    }

    #[test]
    fn resets_local_data_only_after_a_verified_backup_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        let manga_root = dir.path().join("source-manga");
        std::fs::create_dir_all(&manga_root).unwrap();
        let source_page = manga_root.join("001.jpg");
        std::fs::write(&source_page, b"source manga is not application data").unwrap();

        let db = Database::open(&path).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        db.upsert_library(&manga_root, true).unwrap();
        db.set_setting(
            "reset.marker".to_string(),
            serde_json::json!("old database"),
        )
        .unwrap();
        let schedule = db.schedule_database_reset().unwrap();
        assert!(schedule.restart_required);
        assert!(healthy_sqlite_file(Path::new(&schedule.backup_path)));
        assert!(pending_reset_path(&path).exists());
        drop(db);

        let outcome = Database::apply_pending_reset(&path).unwrap().unwrap();
        assert!(outcome.success, "{}", outcome.message);
        assert!(healthy_sqlite_file(&path));
        assert!(healthy_sqlite_file(Path::new(
            outcome.backup_path.as_deref().unwrap()
        )));
        assert!(healthy_sqlite_file(Path::new(
            outcome.archive_path.as_deref().unwrap()
        )));
        assert!(!pending_reset_path(&path).exists());
        assert_eq!(
            std::fs::read(&source_page).unwrap(),
            b"source manga is not application data"
        );

        let reset = Database::open(&path).unwrap();
        reset.register_reset_snapshots(&outcome).unwrap();
        let summary = reset.local_data_summary().unwrap();
        assert_eq!(summary.libraries, 0);
        assert_eq!(summary.books, 0);
        assert_eq!(summary.reading_history, 0);
        assert_eq!(summary.reading_progress, 0);
        assert_eq!(summary.bookmarks, 0);
        assert!(reset.existing_data_notice_acknowledged().unwrap());
        let snapshots = reset.list_backup_snapshots().unwrap();
        assert!(snapshots.iter().any(|item| item.reason == "pre-reset"));
        assert!(snapshots.iter().any(|item| item.reason == "reset-archive"));
    }

    #[test]
    fn refuses_reset_when_the_safety_backup_is_unhealthy() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        let db = Database::open(&path).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        db.set_setting("reset.marker".to_string(), serde_json::json!("keep me"))
            .unwrap();
        let schedule = db.schedule_database_reset().unwrap();
        drop(db);
        std::fs::write(&schedule.backup_path, b"not sqlite").unwrap();

        let outcome = Database::apply_pending_reset(&path).unwrap().unwrap();
        assert!(!outcome.success);
        assert!(healthy_sqlite_file(&path));
        let existing = Database::open(&path).unwrap();
        assert_eq!(
            existing.get_settings().unwrap()["reset.marker"],
            serde_json::json!("keep me")
        );
    }

    #[test]
    fn refuses_reset_while_a_scan_job_is_active() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        let db = Database::open(&path).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        db.create_scan_job(None, dir.path()).unwrap();

        let error = db.schedule_database_reset().unwrap_err().to_string();
        assert!(error.contains("scan is active"));
        assert!(!pending_reset_path(&path).exists());
    }

    #[test]
    fn resetting_preferences_preserves_the_existing_data_acknowledgement() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        db.acknowledge_existing_data_notice().unwrap();
        db.set_setting("appearance.theme".to_string(), serde_json::json!("light"))
            .unwrap();

        let reset = db.reset_settings().unwrap();

        assert_eq!(reset["appearance.theme"], serde_json::json!("system"));
        assert!(db.existing_data_notice_acknowledged().unwrap());
    }

    #[test]
    fn ignores_a_malformed_restore_request_without_blocking_startup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        std::fs::write(pending_restore_path(&path), b"not json").unwrap();

        assert!(Database::apply_pending_restore(&path).unwrap().is_none());
        assert!(!pending_restore_path(&path).exists());
        assert!(dir
            .path()
            .read_dir()
            .unwrap()
            .filter_map(std::result::Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("test.restore-failed-")));
    }

    #[test]
    fn recovers_the_latest_unique_backup_after_database_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite3");
        let db = Database::open(&path).unwrap();
        db.migrate().unwrap();

        db.set_setting("recovery.marker".to_string(), serde_json::json!("first"))
            .unwrap();
        let first_backup = db.create_backup().unwrap();
        db.set_setting("recovery.marker".to_string(), serde_json::json!("latest"))
            .unwrap();
        let latest_backup = db.create_backup().unwrap();
        assert_ne!(first_backup, latest_backup);
        drop(db);

        std::fs::write(&path, b"not a sqlite database").unwrap();
        let (recovered, corrupt_backup) = Database::open_with_recovery(&path).unwrap();

        assert!(corrupt_backup.unwrap().exists());
        assert_eq!(
            recovered.get_settings().unwrap()["recovery.marker"],
            serde_json::json!("latest")
        );
        assert!(recovered.health().unwrap().ok);
    }

    #[test]
    fn creates_extension_schema_without_enabling_online_features() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();

        let mut stmt = db
            .conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type='table' AND name IN (
                   'plugin_manifests', 'ai_providers', 'sync_settings',
                   'telemetry_settings', 'upscale_jobs', 'upscale_cache'
                 )
                 ORDER BY name",
            )
            .unwrap();
        let tables = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            tables,
            vec![
                "ai_providers",
                "plugin_manifests",
                "sync_settings",
                "telemetry_settings",
                "upscale_cache",
                "upscale_jobs"
            ]
        );

        let ai_enabled: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM ai_providers WHERE enabled = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let sync_enabled: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM sync_settings WHERE enabled = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let telemetry_enabled: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM telemetry_settings WHERE enabled = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ai_enabled, 0);
        assert_eq!(sync_enabled, 0);
        assert_eq!(telemetry_enabled, 0);
        let feature_enabled: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM feature_flags WHERE enabled = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(feature_enabled, 0);
        let counts = db.reader_settings_scope_counts().unwrap();
        assert_eq!(counts.book_settings, 0);
        assert_eq!(counts.series_settings, 0);
    }

    #[test]
    fn creates_library_performance_indexes() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();

        let expected = vec![
            "idx_book_tags_tag_book",
            "idx_books_active_author_title",
            "idx_books_active_checksum",
            "idx_books_active_favorite_title",
            "idx_books_active_format_title",
            "idx_books_active_imported",
            "idx_books_active_rating",
            "idx_books_active_recent",
            "idx_books_active_status_title",
            "idx_books_active_title",
            "idx_reading_progress_percent",
            "idx_thumbnails_book_page_key",
        ];
        let placeholders = std::iter::repeat("?")
            .take(expected.len())
            .collect::<Vec<_>>()
            .join(",");
        let mut stmt = db
            .conn
            .prepare(&format!(
                "SELECT name FROM sqlite_master
                 WHERE type='index' AND name IN ({placeholders})
                 ORDER BY name"
            ))
            .unwrap();
        let indexes = stmt
            .query_map(rusqlite::params_from_iter(expected.iter()), |row| {
                row.get::<_, String>(0)
            })
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(indexes, expected);

        let active_index_sql: String = db
            .conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_books_active_title'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(active_index_sql.contains("WHERE status != 'deleted'"));
    }

    #[test]
    fn clears_upscale_cache_records() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let stamp = now();
        db.conn
            .execute(
                "INSERT INTO upscale_cache(
                   cache_key, source_path, output_path, byte_size,
                   created_at, updated_at, last_accessed_at
                 ) VALUES (?1, ?2, ?3, 10, ?4, ?4, ?4)",
                params![
                    "cache-key",
                    "D:/source/page.png",
                    "D:/cache/page.webp",
                    stamp
                ],
            )
            .unwrap();

        assert_eq!(db.list_upscale_cache_paths().unwrap().len(), 1);
        assert_eq!(db.clear_upscale_cache_records().unwrap(), 1);
        assert!(db.list_upscale_cache_paths().unwrap().is_empty());
    }

    #[test]
    fn removes_stale_thumbnail_records_when_the_disk_file_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(dir.path(), true).unwrap();
        let book_id = db
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: "Thumbnail book".to_string(),
                sort_title: "thumbnail book".to_string(),
                author: None,
                volume: None,
                chapter: None,
                path: dir.path().join("book").to_string_lossy().to_string(),
                format: "folder".to_string(),
                file_size: 0,
                modified_at: None,
                page_count: 0,
                checksum: None,
                pages: Vec::new(),
            })
            .unwrap();
        let cache_path = dir.path().join("thumbnail.jpg");
        std::fs::write(&cache_path, b"thumbnail").unwrap();
        db.upsert_thumbnail(ThumbnailRecord {
            book_id,
            page_index: 0,
            cache_key: "thumbnail-key",
            disk_path: &cache_path,
            width: 1,
            height: 1,
            byte_size: 9,
        })
        .unwrap();

        assert_eq!(
            db.find_thumbnail_path(book_id, 0, "thumbnail-key").unwrap(),
            Some(cache_path.clone())
        );
        std::fs::remove_file(cache_path).unwrap();
        assert!(db
            .find_thumbnail_path(book_id, 0, "thumbnail-key")
            .unwrap()
            .is_none());
        let remaining: i64 = db
            .conn
            .query_row("SELECT count(*) FROM thumbnails", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn removes_evicted_thumbnail_records_by_disk_path() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(dir.path(), true).unwrap();
        let book_id = db
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: "Evicted thumbnail book".to_string(),
                sort_title: "evicted thumbnail book".to_string(),
                author: None,
                volume: None,
                chapter: None,
                path: dir.path().join("book").to_string_lossy().to_string(),
                format: "folder".to_string(),
                file_size: 0,
                modified_at: None,
                page_count: 0,
                checksum: None,
                pages: Vec::new(),
            })
            .unwrap();
        let cache_path = dir.path().join("evicted.jpg");
        db.conn
            .execute(
                "INSERT INTO thumbnails(book_id, page_index, cache_key, disk_path, width, height, byte_size, created_at, last_accessed_at)
                 VALUES (?1, 0, 'evicted-key', ?2, 1, 1, 8, ?3, ?3)",
                params![book_id, cache_path.to_string_lossy().to_string(), now()],
            )
            .unwrap();

        assert_eq!(
            db.delete_thumbnail_records_by_paths(&[cache_path]).unwrap(),
            1
        );
        let remaining: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM thumbnails WHERE cache_key='evicted-key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    #[ignore = "run explicitly for the 10k library performance gate"]
    fn benchmarks_ten_thousand_book_library_queries() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("benchmark.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(dir.path(), true).unwrap();
        let started = Instant::now();
        let stamp = now();
        let tx = db.conn.transaction().unwrap();
        for index in 0..10_000 {
            let title = format!("夏日漫画 第{index:05}话");
            tx.execute(
                "INSERT INTO books(library_id, title, sort_title, path, format, file_size, page_count, status, imported_at, updated_at)
                 VALUES (?1, ?2, ?2, ?3, 'folder', 0, 24, 'available', ?4, ?4)",
                params![
                    library.id,
                    title,
                    format!("D:/Benchmark/{index:05}"),
                    stamp
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let indexed_at = started.elapsed();

        let page_started = Instant::now();
        let page = db
            .list_books(BookQuery {
                search: None,
                sort: Some("title".to_string()),
                view: None,
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: None,
                limit: Some(240),
                offset: Some(4_800),
            })
            .unwrap();
        let page_elapsed = page_started.elapsed();

        let search_started = Instant::now();
        let search = db
            .list_books(BookQuery {
                search: Some("漫画 第050".to_string()),
                sort: Some("title".to_string()),
                view: None,
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: None,
                limit: Some(240),
                offset: Some(0),
            })
            .unwrap();
        let search_elapsed = search_started.elapsed();

        assert_eq!(page.len(), 240);
        assert_eq!(search.len(), 100);
        assert!(page_elapsed < std::time::Duration::from_secs(2));
        assert!(search_elapsed < std::time::Duration::from_secs(2));
        eprintln!(
            "10k benchmark: index={}ms page={}ms search={}ms",
            indexed_at.as_millis(),
            page_elapsed.as_millis(),
            search_elapsed.as_millis()
        );
    }

    #[test]
    fn optimizes_database_and_reports_counts() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();

        let result = db.optimize_database(false).unwrap();

        assert!(!result.vacuum);
        assert!(result.page_count_before > 0);
        assert!(result.page_count_after > 0);
        assert!(result.elapsed_ms >= 0);
    }

    #[test]
    fn lists_libraries_for_maintenance() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        std::fs::create_dir_all(&library_dir).unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();

        let libraries = db.list_libraries().unwrap();
        assert_eq!(libraries.len(), 1);
        assert_eq!(libraries[0].id, library.id);
        assert!(libraries[0].recursive);
        assert_eq!(libraries[0].book_count, 0);
    }

    #[test]
    fn lists_large_library_books_with_batched_tags() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        std::fs::create_dir_all(&library_dir).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        let first_id = db
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: "Signal Garden".to_string(),
                sort_title: "signal garden".to_string(),
                author: Some("Ada".to_string()),
                volume: Some(1.0),
                chapter: Some(1.0),
                path: library_dir
                    .join("Signal Garden.cbz")
                    .to_string_lossy()
                    .to_string(),
                format: "cbz".to_string(),
                file_size: 128,
                modified_at: None,
                page_count: 1,
                checksum: Some("first".to_string()),
                pages: vec![ScannedPage {
                    page_index: 0,
                    source_path: "page-001.jpg".to_string(),
                    width: Some(1000),
                    height: Some(1400),
                    byte_size: Some(128),
                }],
            })
            .unwrap();
        db.upsert_scanned_book(&ScannedBook {
            library_id: library.id,
            title: "Quiet Signal".to_string(),
            sort_title: "quiet signal".to_string(),
            author: Some("Grace".to_string()),
            volume: Some(1.0),
            chapter: Some(2.0),
            path: library_dir
                .join("Quiet Signal.cbz")
                .to_string_lossy()
                .to_string(),
            format: "cbz".to_string(),
            file_size: 256,
            modified_at: None,
            page_count: 1,
            checksum: Some("second".to_string()),
            pages: vec![ScannedPage {
                page_index: 0,
                source_path: "page-001.jpg".to_string(),
                width: Some(1000),
                height: Some(1400),
                byte_size: Some(256),
            }],
        })
        .unwrap();
        db.set_book_tags(first_id, vec!["已读".to_string(), "收藏".to_string()])
            .unwrap();

        let books = db
            .list_books(BookQuery {
                search: None,
                sort: Some("title".to_string()),
                view: None,
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: None,
                limit: Some(10_000),
                offset: Some(0),
            })
            .unwrap();

        assert_eq!(books.len(), 2);
        let tagged = books.iter().find(|book| book.id == first_id).unwrap();
        assert_eq!(tagged.tags, vec!["已读", "收藏"]);

        let ada_books = db
            .list_books(BookQuery {
                search: None,
                sort: Some("title".to_string()),
                view: None,
                favorite: None,
                author: Some("Ada".to_string()),
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: None,
                limit: Some(10_000),
                offset: Some(0),
            })
            .unwrap();
        assert_eq!(ada_books.len(), 1);
        assert_eq!(ada_books[0].id, first_id);
        assert_eq!(db.list_authors().unwrap(), vec!["Ada", "Grace"]);
        assert_eq!(db.list_formats().unwrap(), vec!["cbz"]);
    }

    #[test]
    fn series_view_orders_each_series_contiguously_by_volume_and_chapter() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        std::fs::create_dir_all(&library_dir).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        for (title, volume, chapter) in [
            ("Zeta Story", 1.0, 1.0),
            ("Alpha Story", 2.0, 1.0),
            ("Alpha Story", 1.0, 2.0),
        ] {
            db.upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: title.to_string(),
                sort_title: title.to_ascii_lowercase(),
                author: None,
                volume: Some(volume),
                chapter: Some(chapter),
                path: library_dir
                    .join(format!("{title}-{volume}-{chapter}.cbz"))
                    .to_string_lossy()
                    .to_string(),
                format: "cbz".to_string(),
                file_size: 1,
                modified_at: None,
                page_count: 0,
                checksum: None,
                pages: Vec::new(),
            })
            .unwrap();
        }

        let books = db
            .list_books(BookQuery {
                search: None,
                sort: Some("recent".to_string()),
                view: Some("series".to_string()),
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: None,
                limit: Some(20),
                offset: Some(0),
            })
            .unwrap();

        assert_eq!(
            books
                .iter()
                .map(|book| (book.title.as_str(), book.volume, book.chapter))
                .collect::<Vec<_>>(),
            vec![
                ("Alpha Story", Some(1.0), Some(2.0)),
                ("Alpha Story", Some(2.0), Some(1.0)),
                ("Zeta Story", Some(1.0), Some(1.0)),
            ]
        );
    }

    #[test]
    fn unchanged_scanned_books_skip_page_rewrites() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        std::fs::create_dir_all(&library_dir).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        let path = library_dir
            .join("Stable Book")
            .to_string_lossy()
            .to_string();
        let book = ScannedBook {
            library_id: library.id,
            title: "Stable Book".to_string(),
            sort_title: "stable book".to_string(),
            author: Some("作者".to_string()),
            volume: None,
            chapter: None,
            path,
            format: "folder".to_string(),
            file_size: 20,
            modified_at: Some("2026-07-09T00:00:00Z".to_string()),
            page_count: 2,
            checksum: Some("stable".to_string()),
            pages: vec![
                ScannedPage {
                    page_index: 0,
                    source_path: "upscaled/第1话/0001.webp".to_string(),
                    width: None,
                    height: None,
                    byte_size: Some(10),
                },
                ScannedPage {
                    page_index: 1,
                    source_path: "upscaled/第1话/0002.webp".to_string(),
                    width: None,
                    height: None,
                    byte_size: Some(10),
                },
            ],
        };

        let first_id = db.upsert_scanned_book(&book).unwrap();
        let first_page_rows = page_row_ids(&db, first_id);
        let second_id = db.upsert_scanned_book(&book).unwrap();
        let second_page_rows = page_row_ids(&db, second_id);

        assert_eq!(second_id, first_id);
        assert_eq!(second_page_rows, first_page_rows);

        let mut changed = book.clone();
        changed.pages[1].source_path = "upscaled/第2话/0001.webp".to_string();
        let third_id = db.upsert_scanned_book(&changed).unwrap();
        let third_page_rows = page_row_ids(&db, third_id);

        assert_eq!(third_id, first_id);
        assert_ne!(third_page_rows, first_page_rows);
        assert_eq!(
            db.page_for_book(third_id, 1).unwrap().unwrap().source_path,
            "upscaled/第2话/0001.webp"
        );

        let mut same_sized_content_change = changed.clone();
        same_sized_content_change.checksum = Some("changed-content-fingerprint".to_string());
        let fourth_id = db.upsert_scanned_book(&same_sized_content_change).unwrap();
        let fourth_page_rows = page_row_ids(&db, fourth_id);

        assert_eq!(fourth_id, first_id);
        assert_ne!(fourth_page_rows, third_page_rows);
    }

    #[test]
    fn rescans_preserve_existing_metadata_and_manual_history() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        std::fs::create_dir_all(&library_dir).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        let mut scanned = ScannedBook {
            library_id: library.id,
            title: "(C107) [作者] 原始标题".to_string(),
            sort_title: "(c107) [作者] 原始标题".to_string(),
            author: Some("作者".to_string()),
            volume: None,
            chapter: None,
            path: library_dir
                .join("(C107) [作者] 原始标题")
                .to_string_lossy()
                .to_string(),
            format: "folder".to_string(),
            file_size: 10,
            modified_at: Some("2026-07-14T00:00:00Z".to_string()),
            page_count: 1,
            checksum: Some("first".to_string()),
            pages: vec![ScannedPage {
                page_index: 0,
                source_path: "original/001.webp".to_string(),
                width: None,
                height: None,
                byte_size: Some(10),
            }],
        };
        let id = db.upsert_scanned_book(&scanned).unwrap();
        db.update_book_metadata(
            id,
            MetadataUpdate {
                title: "我的手工标题（保留）".to_string(),
                author: Some("手工作者".to_string()),
                volume: Some(8.0),
                chapter: Some(2.0),
            },
        )
        .unwrap();

        scanned.title = "扫描器的新候选标题".to_string();
        scanned.sort_title = "扫描器的新候选标题".to_string();
        scanned.author = Some("自动作者".to_string());
        scanned.volume = Some(9.0);
        scanned.chapter = Some(107.0);
        scanned.checksum = Some("changed".to_string());
        db.upsert_scanned_book(&scanned).unwrap();

        let book = db.get_book(id).unwrap();
        assert_eq!(book.title, "我的手工标题（保留）");
        assert_eq!(book.author.as_deref(), Some("手工作者"));
        assert_eq!(book.volume, Some(8.0));
        assert_eq!(book.chapter, Some(2.0));
        let manual_title_changes: i64 = db
            .conn
            .query_row(
                "SELECT count(*) FROM metadata_history
                 WHERE book_id=?1 AND source_id IS NULL AND field_name='title'",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(manual_title_changes, 1);
    }

    #[test]
    fn duplicate_filter_finds_books_with_matching_checksums() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        std::fs::create_dir_all(&library_dir).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        for title in ["重复作品 A", "重复作品 B"] {
            db.upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: title.to_string(),
                sort_title: title.to_string(),
                author: Some("作者".to_string()),
                volume: None,
                chapter: None,
                path: library_dir.join(title).to_string_lossy().to_string(),
                format: "folder".to_string(),
                file_size: 20,
                modified_at: None,
                page_count: 2,
                checksum: Some("same-folder-structure".to_string()),
                pages: vec![
                    ScannedPage {
                        page_index: 0,
                        source_path: "001.webp".to_string(),
                        width: None,
                        height: None,
                        byte_size: Some(10),
                    },
                    ScannedPage {
                        page_index: 1,
                        source_path: "002.webp".to_string(),
                        width: None,
                        height: None,
                        byte_size: Some(10),
                    },
                ],
            })
            .unwrap();
        }
        db.upsert_scanned_book(&ScannedBook {
            library_id: library.id,
            title: "独立作品".to_string(),
            sort_title: "独立作品".to_string(),
            author: Some("作者".to_string()),
            volume: None,
            chapter: None,
            path: library_dir.join("独立作品").to_string_lossy().to_string(),
            format: "folder".to_string(),
            file_size: 10,
            modified_at: None,
            page_count: 1,
            checksum: Some("unique-folder-structure".to_string()),
            pages: vec![ScannedPage {
                page_index: 0,
                source_path: "001.webp".to_string(),
                width: None,
                height: None,
                byte_size: Some(10),
            }],
        })
        .unwrap();

        let duplicates = db
            .list_books(BookQuery {
                search: None,
                sort: Some("title".to_string()),
                view: None,
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: Some(true),
                limit: Some(50),
                offset: Some(0),
            })
            .unwrap();

        assert_eq!(duplicates.len(), 2);
        assert!(duplicates
            .iter()
            .all(|book| book.title.starts_with("重复作品")));
    }

    #[test]
    fn upserting_logical_book_hides_nested_chapter_books() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        let work_dir = library_dir.join("作者").join("示例作品");
        std::fs::create_dir_all(work_dir.join("original").join("第1话")).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        let nested_id = db
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: "示例作品 第1话".to_string(),
                sort_title: "示例作品 第1话".to_string(),
                author: None,
                volume: None,
                chapter: Some(1.0),
                path: work_dir
                    .join("original")
                    .join("第1话")
                    .to_string_lossy()
                    .to_string(),
                format: "folder".to_string(),
                file_size: 8,
                modified_at: None,
                page_count: 1,
                checksum: Some("nested".to_string()),
                pages: vec![ScannedPage {
                    page_index: 0,
                    source_path: "0001.webp".to_string(),
                    width: None,
                    height: None,
                    byte_size: Some(8),
                }],
            })
            .unwrap();

        let logical_id = db
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: "示例作品".to_string(),
                sort_title: "示例作品".to_string(),
                author: None,
                volume: None,
                chapter: None,
                path: work_dir.to_string_lossy().to_string(),
                format: "folder".to_string(),
                file_size: 16,
                modified_at: None,
                page_count: 2,
                checksum: Some("logical".to_string()),
                pages: vec![
                    ScannedPage {
                        page_index: 0,
                        source_path: "original/第1话/0001.webp".to_string(),
                        width: None,
                        height: None,
                        byte_size: Some(8),
                    },
                    ScannedPage {
                        page_index: 1,
                        source_path: "original/第2话/0001.webp".to_string(),
                        width: None,
                        height: None,
                        byte_size: Some(8),
                    },
                ],
            })
            .unwrap();

        assert_eq!(db.get_book(nested_id).unwrap().status, "deleted");
        assert_eq!(db.get_book(logical_id).unwrap().status, "available");
        let visible = db
            .list_books(BookQuery {
                search: None,
                sort: Some("title".to_string()),
                view: None,
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: None,
                limit: Some(50),
                offset: Some(0),
            })
            .unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, logical_id);
        let chapters = db.chapters_for_book(logical_id).unwrap();
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "第1话");
        assert_eq!(chapters[0].chapter_number, Some(1.0));
        assert_eq!(chapters[0].start_page, 0);
        assert_eq!(chapters[0].page_count, 1);
        assert_eq!(chapters[1].title, "第2话");
        assert_eq!(chapters[1].chapter_number, Some(2.0));
        assert_eq!(chapters[1].start_page, 1);
        assert_eq!(chapters[1].page_count, 1);
    }

    #[test]
    fn direct_image_books_do_not_hide_separate_nested_books() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        let parent_dir = library_dir.join("画集");
        let nested_dir = parent_dir.join("特典");
        std::fs::create_dir_all(&nested_dir).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        let nested_id = db
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: "特典".to_string(),
                sort_title: "特典".to_string(),
                author: None,
                volume: None,
                chapter: None,
                path: nested_dir.to_string_lossy().to_string(),
                format: "folder".to_string(),
                file_size: 8,
                modified_at: None,
                page_count: 1,
                checksum: Some("bonus".to_string()),
                pages: vec![ScannedPage {
                    page_index: 0,
                    source_path: "0001.webp".to_string(),
                    width: None,
                    height: None,
                    byte_size: Some(8),
                }],
            })
            .unwrap();
        db.upsert_scanned_book(&ScannedBook {
            library_id: library.id,
            title: "画集".to_string(),
            sort_title: "画集".to_string(),
            author: None,
            volume: None,
            chapter: None,
            path: parent_dir.to_string_lossy().to_string(),
            format: "folder".to_string(),
            file_size: 8,
            modified_at: None,
            page_count: 1,
            checksum: Some("parent".to_string()),
            pages: vec![ScannedPage {
                page_index: 0,
                source_path: "cover.webp".to_string(),
                width: None,
                height: None,
                byte_size: Some(8),
            }],
        })
        .unwrap();

        assert_eq!(db.get_book(nested_id).unwrap().status, "available");
    }

    #[test]
    fn fetches_one_page_without_loading_the_full_page_list() {
        let dir = tempfile::tempdir().unwrap();
        let library_dir = dir.path().join("library");
        std::fs::create_dir_all(&library_dir).unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&library_dir, true).unwrap();
        let book_id = db
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: "Fast Pages".to_string(),
                sort_title: "fast pages".to_string(),
                author: None,
                volume: None,
                chapter: None,
                path: library_dir
                    .join("Fast Pages.cbz")
                    .to_string_lossy()
                    .to_string(),
                format: "cbz".to_string(),
                file_size: 512,
                modified_at: None,
                page_count: 3,
                checksum: Some("fast-pages".to_string()),
                pages: vec![
                    ScannedPage {
                        page_index: 0,
                        source_path: "001.jpg".to_string(),
                        width: Some(100),
                        height: Some(140),
                        byte_size: Some(10),
                    },
                    ScannedPage {
                        page_index: 1,
                        source_path: "002.jpg".to_string(),
                        width: Some(100),
                        height: Some(140),
                        byte_size: Some(10),
                    },
                    ScannedPage {
                        page_index: 2,
                        source_path: "003.jpg".to_string(),
                        width: Some(100),
                        height: Some(140),
                        byte_size: Some(10),
                    },
                ],
            })
            .unwrap();

        let page = db.page_for_book(book_id, 1).unwrap().unwrap();

        assert_eq!(page.page_index, 1);
        assert_eq!(page.source_path, "002.jpg");
        assert!(db.page_for_book(book_id, 99).unwrap().is_none());

        let source = db.page_source_for_book(book_id, 1).unwrap().unwrap();
        assert_eq!(source.source_path, "002.jpg");
        assert!(source.book_path.ends_with("Fast Pages.cbz"));
        assert!(!source.book_updated_at.is_empty());
        assert!(db.page_source_for_book(book_id, 99).unwrap().is_none());
    }

    #[test]
    fn removes_a_library_without_touching_other_library_records() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        let first_root = dir.path().join("first");
        let second_root = dir.path().join("second");
        std::fs::create_dir_all(&first_root).unwrap();
        std::fs::create_dir_all(&second_root).unwrap();
        let first = db.upsert_library(&first_root, true).unwrap();
        let second = db.upsert_library(&second_root, true).unwrap();
        let first_book = db
            .upsert_scanned_book(&ScannedBook {
                library_id: first.id,
                title: "First".to_string(),
                sort_title: "first".to_string(),
                author: None,
                volume: None,
                chapter: None,
                path: first_root.join("first.cbz").to_string_lossy().to_string(),
                format: "cbz".to_string(),
                file_size: 1,
                modified_at: None,
                page_count: 1,
                checksum: None,
                pages: vec![ScannedPage {
                    page_index: 0,
                    source_path: "001.jpg".to_string(),
                    width: None,
                    height: None,
                    byte_size: None,
                }],
            })
            .unwrap();
        let second_book = db
            .upsert_scanned_book(&ScannedBook {
                library_id: second.id,
                title: "Second".to_string(),
                sort_title: "second".to_string(),
                author: None,
                volume: None,
                chapter: None,
                path: second_root.join("second.cbz").to_string_lossy().to_string(),
                format: "cbz".to_string(),
                file_size: 1,
                modified_at: None,
                page_count: 1,
                checksum: None,
                pages: Vec::new(),
            })
            .unwrap();
        db.save_progress(first_book, 0, 1, "single".to_string(), "ltr".to_string())
            .unwrap();
        db.add_bookmark(first_book, 0, None).unwrap();

        let preview = db.library_removal_preview(first.id).unwrap();
        assert_eq!(preview.books, 1);
        assert_eq!(preview.bookmarks, 1);
        let removed = db.remove_library(first.id).unwrap();

        assert_eq!(removed.books_removed, 1);
        assert_eq!(db.list_libraries().unwrap().len(), 1);
        assert_eq!(db.get_book(second_book).unwrap().title, "Second");
        assert!(db.get_book(first_book).is_err());
        assert!(first_root.exists());
    }

    #[test]
    fn clearing_history_and_resetting_settings_keep_library_data() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        let library_root = dir.path().join("library");
        std::fs::create_dir_all(&library_root).unwrap();
        let library = db.upsert_library(&library_root, true).unwrap();
        db.conn
            .execute(
                "INSERT INTO books(
                   library_id, title, sort_title, path, format, imported_at, updated_at
                 ) VALUES (?1, 'History', 'history', ?2, 'cbz', ?3, ?3)",
                params![
                    library.id,
                    library_root
                        .join("history.cbz")
                        .to_string_lossy()
                        .to_string(),
                    now()
                ],
            )
            .unwrap();
        let book_id = db.conn.last_insert_rowid();
        db.record_reading_opened(book_id, 0).unwrap();
        db.set_setting("appearance.theme".to_string(), serde_json::json!("dark"))
            .unwrap();

        assert_eq!(db.list_history().unwrap().len(), 1);
        assert_eq!(db.clear_reading_history().unwrap(), 1);
        assert!(db.list_history().unwrap().is_empty());
        let settings = db.reset_settings().unwrap();

        assert_eq!(settings["appearance.theme"], serde_json::json!("system"));
        assert_eq!(db.list_libraries().unwrap()[0].id, library.id);
    }

    #[test]
    fn recent_reading_is_unique_paginated_and_keeps_data_operations_separate() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        let root = dir.path().join("library");
        std::fs::create_dir_all(&root).unwrap();
        let library = db.upsert_library(&root, true).unwrap();
        let insert_book = |title: &str, page_count: i64| {
            db.conn
                .execute(
                    "INSERT INTO books(
                       library_id, title, sort_title, path, format, page_count, imported_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, 'cbz', ?5, ?6, ?6)",
                    params![
                        library.id,
                        title,
                        normalize_sort_title(title),
                        root.join(format!("{title}.cbz")).to_string_lossy().to_string(),
                        page_count,
                        now()
                    ],
                )
                .unwrap();
            db.conn.last_insert_rowid()
        };
        let first = insert_book("First", 10);
        let second = insert_book("Second", 4);
        db.record_reading_opened(first, 0).unwrap();
        db.record_reading_opened(first, 1).unwrap();
        db.save_progress(first, 3, 10, "single".to_string(), "ltr".to_string())
            .unwrap();
        db.record_reading_opened(second, 0).unwrap();
        db.add_bookmark(first, 3, None).unwrap();

        let page = db
            .list_recent_reading(RecentReadingQuery {
                search: None,
                filter: Some("all".to_string()),
                sort: Some("title".to_string()),
                limit: Some(1),
                offset: Some(0),
                timezone_offset_minutes: None,
            })
            .unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].book.id, first);
        assert_eq!(page.items[0].current_page, 3);

        let history_only = db
            .list_recent_reading(RecentReadingQuery {
                search: Some("Second".to_string()),
                filter: Some("unfinished".to_string()),
                sort: Some("progress".to_string()),
                limit: None,
                offset: None,
                timezone_offset_minutes: Some(-480),
            })
            .unwrap();
        assert_eq!(history_only.items.len(), 1);
        assert_eq!(history_only.items[0].book.id, second);
        assert_eq!(history_only.items[0].progress_percent, 0.25);

        assert!(db.remove_recent_reading(first).unwrap() > 0);
        assert!(db.get_progress(first).unwrap().is_some());
        assert_eq!(db.list_bookmarks(first).unwrap().len(), 1);
        assert_eq!(db.get_book(first).unwrap().title, "First");

        db.record_reading_opened(first, 3).unwrap();
        db.reset_reading_progress(first).unwrap();
        assert!(db.get_progress(first).unwrap().is_none());
        let reset = db
            .list_recent_reading(RecentReadingQuery {
                search: Some("First".to_string()),
                filter: None,
                sort: None,
                limit: None,
                offset: None,
                timezone_offset_minutes: None,
            })
            .unwrap();
        assert_eq!(reset.items[0].current_page, 0);
        assert_eq!(db.list_bookmarks(first).unwrap().len(), 1);

        let finished = db.mark_book_read(first).unwrap();
        assert_eq!(finished.current_page, 9);
        assert_eq!(finished.percent, 1.0);
        assert!(db
            .list_recent_reading(RecentReadingQuery {
                search: None,
                filter: Some("finished".to_string()),
                sort: Some("progress".to_string()),
                limit: None,
                offset: None,
                timezone_offset_minutes: None,
            })
            .unwrap()
            .items
            .iter()
            .any(|item| item.book.id == first && item.is_finished));
    }

    #[test]
    fn recent_reading_pagination_is_stable_at_the_eighty_item_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("test.sqlite3")).unwrap();
        db.migrate().unwrap();
        let root = dir.path().join("library");
        std::fs::create_dir_all(&root).unwrap();
        let library = db.upsert_library(&root, true).unwrap();
        let opened_at = "2020-01-01T12:00:00+00:00";
        let mut book_ids = Vec::new();
        for index in 1..=81 {
            let title = format!("Boundary Book {index:03}");
            db.conn
                .execute(
                    "INSERT INTO books(
                       library_id, title, sort_title, path, format, page_count, imported_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, 'cbz', 10, ?5, ?5)",
                    params![
                        library.id,
                        title,
                        normalize_sort_title(&title),
                        root.join(format!("{title}.cbz")).to_string_lossy().to_string(),
                        opened_at,
                    ],
                )
                .unwrap();
            let book_id = db.conn.last_insert_rowid();
            book_ids.push(book_id);
            db.conn
                .execute(
                    "INSERT INTO reading_history(book_id, page_index, opened_at) VALUES (?1, 0, ?2)",
                    params![book_id, opened_at],
                )
                .unwrap();
        }

        let query_page = |offset| {
            db.list_recent_reading(RecentReadingQuery {
                search: None,
                filter: Some("unfinished".to_string()),
                sort: Some("recent".to_string()),
                limit: Some(80),
                offset: Some(offset),
                timezone_offset_minutes: Some(-480),
            })
            .unwrap()
        };
        let first_page = query_page(0);
        let second_page = query_page(80);
        assert_eq!(first_page.total, 81);
        assert_eq!(first_page.items.len(), 80);
        assert_eq!(second_page.items.len(), 1);
        let first_ids = first_page
            .items
            .iter()
            .map(|item| item.book.id)
            .collect::<HashSet<_>>();
        assert!(!first_ids.contains(&second_page.items[0].book.id));
        assert_eq!(first_page.items[78].book.id, book_ids[2]);
        assert_eq!(first_page.items[79].book.id, book_ids[1]);
        assert_eq!(second_page.items[0].book.id, book_ids[0]);

        let searched = db
            .list_recent_reading(RecentReadingQuery {
                search: Some("Boundary Book 081".to_string()),
                filter: Some("all".to_string()),
                sort: Some("title".to_string()),
                limit: Some(80),
                offset: Some(0),
                timezone_offset_minutes: None,
            })
            .unwrap();
        assert_eq!(searched.total, 1);
        assert_eq!(searched.items[0].book.id, book_ids[80]);

        let page_tail = first_page.items[79].book.id;
        assert!(db.remove_recent_reading(page_tail).unwrap() > 0);
        let after_delete = query_page(0);
        assert_eq!(after_delete.total, 80);
        assert_eq!(after_delete.items.len(), 80);

        let newest = book_ids[0];
        db.record_reading_opened(newest, 2).unwrap();
        let refreshed = query_page(0);
        assert_eq!(refreshed.items[0].book.id, newest);
        assert_eq!(refreshed.items[0].current_page, 2);

        assert_eq!(db.clear_reading_history().unwrap(), 81);
        let cleared = query_page(0);
        assert_eq!(cleared.total, 0);
        assert!(cleared.items.is_empty());
    }

    fn page_row_ids(db: &Database, book_id: i64) -> Vec<i64> {
        let mut stmt = db
            .conn
            .prepare("SELECT id FROM pages WHERE book_id = ?1 ORDER BY page_index ASC")
            .unwrap();
        stmt.query_map(params![book_id], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap()
    }
}
