use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::db::Database;
use crate::error::{MangaVaultError, Result};
use crate::jmcomic;
use crate::jmcomic_provider::JmComicProviderState;
use crate::models::{
    ExternalBookMetadata, ExternalIdentityCandidate, MetadataBatchPreview, MetadataMergePreview,
};

const PROVIDER_ID: &str = "jmcomic";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JmComicMetadataSettings {
    pub enabled: bool,
    pub endpoint: String,
    pub refresh_days: i64,
    pub request_interval_ms: i64,
    pub database_path: Option<PathBuf>,
    pub auto_link: bool,
    pub auto_enrich_after_import: bool,
}

pub fn settings(db: &Database) -> Result<JmComicMetadataSettings> {
    let values = db.get_settings()?;
    Ok(JmComicMetadataSettings {
        enabled: values
            .get("metadata.jmcomic.enabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        endpoint: values
            .get("metadata.jmcomic.endpoint")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("https://www.cdngwc.cc")
            .to_string(),
        refresh_days: values
            .get("metadata.jmcomic.refresh_days")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(30)
            .clamp(1, 365),
        request_interval_ms: values
            .get("metadata.jmcomic.request_interval_ms")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(1200)
            .clamp(250, 60_000),
        database_path: values
            .get("metadata.jmcomic.database_path")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from),
        auto_link: values
            .get("metadata.jmcomic.auto_link")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        auto_enrich_after_import: values
            .get("metadata.jmcomic.auto_enrich")
            .and_then(serde_json::Value::as_str)
            == Some("after_import"),
    })
}

pub fn configure_local_bridge(db: &Database, database_path: &Path) -> Result<()> {
    db.set_setting(
        "metadata.jmcomic.database_path".to_string(),
        serde_json::Value::String(database_path.to_string_lossy().to_string()),
    )?;
    db.set_setting(
        "metadata.jmcomic.auto_link".to_string(),
        serde_json::Value::Bool(true),
    )?;
    Ok(())
}

pub fn batch_preview(db: &Database, force: bool) -> Result<(MetadataBatchPreview, Vec<i64>)> {
    let identities = db.external_identities(PROVIDER_ID)?;
    let mut eligible = Vec::new();
    let mut fresh_cached = 0_i64;
    let mut token_records = Vec::with_capacity(identities.len());
    for identity in &identities {
        let metadata = db.external_metadata_for_book(identity.book_id, PROVIDER_ID)?;
        let fresh = metadata
            .as_ref()
            .is_some_and(|metadata| cache_is_fresh(&metadata.expires_at));
        token_records.push(format!(
            "{}:{}:{}",
            identity.book_id,
            identity.remote_id,
            metadata
                .as_ref()
                .map(|value| value.expires_at.as_str())
                .unwrap_or("")
        ));
        if force || !fresh {
            eligible.push(identity.book_id);
        } else {
            fresh_cached += 1;
        }
    }
    let token_input = format!(
        "{}|{}|{}|{}",
        force,
        identities.len(),
        token_records.join(","),
        eligible
            .iter()
            .map(i64::to_string)
            .collect::<Vec<_>>()
            .join(",")
    );
    Ok((
        MetadataBatchPreview {
            preview_token: blake3::hash(token_input.as_bytes()).to_hex().to_string(),
            total_linked: identities.len() as i64,
            eligible: eligible.len() as i64,
            fresh_cached,
            generated_at: chrono::Utc::now().to_rfc3339(),
            force,
        },
        eligible,
    ))
}

pub fn reconcile_configured_links(db: &mut Database) -> Result<Vec<ExternalIdentityCandidate>> {
    let config = settings(db)?;
    if !config.auto_link {
        return Ok(Vec::new());
    }
    let Some(database_path) = config.database_path else {
        return Ok(Vec::new());
    };
    if !database_path.is_file() {
        return Err(MangaVaultError::Message(
            "configured JMComic download database is unavailable".to_string(),
        ));
    }
    let preview = jmcomic::preview_matches(&database_path, &db.books_for_external_matching()?)?;
    let candidates = preview
        .items
        .into_iter()
        .filter_map(|item| {
            if item.status != "matched" {
                return None;
            }
            Some(ExternalIdentityCandidate {
                book_id: item.book_id?,
                remote_id: item.jm_id,
                canonical_source_path: item.logical_root_path,
            })
        })
        .collect::<Vec<_>>();
    let mut new_candidates = Vec::new();
    for candidate in &candidates {
        if db
            .external_identity_for_book(candidate.book_id, PROVIDER_ID)?
            .is_none()
        {
            new_candidates.push(candidate.clone());
        }
    }
    db.import_external_identities(PROVIDER_ID, &candidates)?;
    let mut imported = Vec::new();
    for candidate in new_candidates {
        if db
            .external_identity_for_book(candidate.book_id, PROVIDER_ID)?
            .is_some_and(|identity| identity.remote_id == candidate.remote_id)
        {
            imported.push(candidate);
        }
    }
    Ok(imported)
}

pub async fn refresh_book(
    database_path: PathBuf,
    provider: Arc<JmComicProviderState>,
    book_id: i64,
    force: bool,
    requested_by: &str,
) -> Result<MetadataMergePreview> {
    let (identity, config, job) = {
        let db = Database::open(&database_path)?;
        let config = settings(&db)?;
        if !config.enabled {
            return Err(MangaVaultError::Message(
                "JMComic online metadata is disabled; enable it in Library settings first"
                    .to_string(),
            ));
        }
        let identity = db
            .external_identity_for_book(book_id, PROVIDER_ID)?
            .ok_or_else(|| {
                MangaVaultError::Message(
                    "this book has no confirmed JM ID; import identity links first".to_string(),
                )
            })?;
        if !force
            && db
                .external_metadata_for_book(book_id, PROVIDER_ID)?
                .as_ref()
                .is_some_and(|metadata| cache_is_fresh(&metadata.expires_at))
        {
            return db
                .metadata_merge_preview(book_id, PROVIDER_ID)?
                .ok_or_else(|| {
                    MangaVaultError::Message("cached JMComic metadata was unavailable".to_string())
                });
        }
        let job =
            db.create_metadata_job(PROVIDER_ID, book_id, &identity.remote_id, requested_by)?;
        db.update_metadata_job(job.id, "running", None)?;
        (identity, config, job)
    };

    let remote = provider
        .fetch(
            &identity.remote_id,
            &config.endpoint,
            Duration::from_millis(config.request_interval_ms as u64),
        )
        .await;
    let remote = match remote {
        Ok(value) => value,
        Err(error) => {
            if let Ok(db) = Database::open(&database_path) {
                let _ = db.update_metadata_job(job.id, "failed", Some(&error.to_string()));
            }
            return Err(error);
        }
    };
    let fetched_at = chrono::Utc::now();
    let metadata = ExternalBookMetadata {
        book_id,
        provider_id: PROVIDER_ID.to_string(),
        remote_id: remote.remote_id,
        original_title: remote.original_title,
        authors: remote.authors,
        categories: remote.categories,
        tags: remote.tags,
        description: remote.description,
        chapters: remote.chapters,
        remote_cover_url: remote.remote_cover_url,
        fetched_at: fetched_at.to_rfc3339(),
        expires_at: (fetched_at + chrono::Duration::days(config.refresh_days)).to_rfc3339(),
        status: "fresh".to_string(),
        error_message: None,
    };
    let mut db = Database::open(&database_path)?;
    if let Err(error) = db.store_external_metadata(&metadata, &remote.payload_hash) {
        let _ = db.update_metadata_job(job.id, "failed", Some(&error.to_string()));
        return Err(error);
    }
    db.update_metadata_job(job.id, "succeeded", None)?;
    db.metadata_merge_preview(book_id, PROVIDER_ID)?
        .ok_or_else(|| {
            MangaVaultError::Message("stored JMComic metadata was unavailable".to_string())
        })
}

fn cache_is_fresh(expires_at: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(expires_at)
        .map(|value| value.with_timezone(&chrono::Utc) > chrono::Utc::now())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ScannedBook;
    use crate::models::ExternalIdentityCandidate;
    use rusqlite::{params, Connection};

    fn add_book(db: &mut Database, root: &Path) -> i64 {
        let library = db.upsert_library(root.parent().unwrap(), true).unwrap();
        db.upsert_scanned_book(&ScannedBook {
            library_id: library.id,
            title: root.file_name().unwrap().to_string_lossy().to_string(),
            sort_title: root.file_name().unwrap().to_string_lossy().to_string(),
            author: None,
            volume: None,
            chapter: None,
            path: root.to_string_lossy().to_string(),
            format: "folder".to_string(),
            file_size: 0,
            modified_at: None,
            page_count: 0,
            checksum: None,
            pages: Vec::new(),
        })
        .unwrap()
    }

    fn create_download_database(path: &Path, book_id: &str, source: &Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE download(
                    bookId varchar PRIMARY KEY, title varchar, savePath varchar,
                    convertPath varchar, tick INT
                );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO download VALUES (?1, 'Source title', ?2, ?3, 1)",
                params![
                    book_id,
                    source.join("original").to_string_lossy(),
                    source.join("waifu2x").to_string_lossy()
                ],
            )
            .unwrap();
    }

    #[test]
    fn metadata_cache_expiry_is_checked_as_an_instant() {
        assert!(cache_is_fresh("2999-01-01T00:00:00Z"));
        assert!(!cache_is_fresh("2000-01-01T00:00:00Z"));
        assert!(!cache_is_fresh("invalid"));
    }

    #[test]
    fn configured_bridge_links_a_new_exact_logical_root_once() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Artist").join("Work");
        std::fs::create_dir_all(source.join("original")).unwrap();
        let source_database = dir.path().join("download.db");
        create_download_database(&source_database, "12345", &source);
        let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
        db.migrate().unwrap();
        let book_id = add_book(&mut db, &source);
        configure_local_bridge(&db, &source_database).unwrap();

        let first = reconcile_configured_links(&mut db).unwrap();
        let second = reconcile_configured_links(&mut db).unwrap();

        assert_eq!(first.len(), 1);
        assert_eq!(first[0].book_id, book_id);
        assert_eq!(first[0].remote_id, "12345");
        assert!(second.is_empty());
    }

    #[test]
    fn batch_preview_token_changes_when_linked_identity_changes() {
        let dir = tempfile::tempdir().unwrap();
        let first_root = dir.path().join("First");
        let second_root = dir.path().join("Second");
        std::fs::create_dir_all(&first_root).unwrap();
        std::fs::create_dir_all(&second_root).unwrap();
        let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
        db.migrate().unwrap();
        let first = add_book(&mut db, &first_root);
        let second = add_book(&mut db, &second_root);
        db.import_external_identities(
            PROVIDER_ID,
            &[ExternalIdentityCandidate {
                book_id: first,
                remote_id: "111".to_string(),
                canonical_source_path: first_root.to_string_lossy().to_string(),
            }],
        )
        .unwrap();
        let before = batch_preview(&db, false).unwrap().0;
        db.import_external_identities(
            PROVIDER_ID,
            &[ExternalIdentityCandidate {
                book_id: second,
                remote_id: "222".to_string(),
                canonical_source_path: second_root.to_string_lossy().to_string(),
            }],
        )
        .unwrap();
        let after = batch_preview(&db, false).unwrap().0;

        assert_ne!(before.preview_token, after.preview_token);
        assert_eq!(before.eligible, 1);
        assert_eq!(after.eligible, 2);
    }
}
