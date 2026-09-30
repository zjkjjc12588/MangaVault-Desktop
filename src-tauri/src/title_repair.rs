use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use blake3::Hasher;
use chrono::Utc;
use regex::Regex;
use rusqlite::types::ValueRef;
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use serde::Serialize;

use crate::db::{healthy_sqlite_file, normalize_sort_title, Database};
use crate::error::{MangaVaultError, Result};
use crate::scanner::{logical_book_root_for_image_dir, parse_title, ParsedTitle};

const REPAIR_SOURCE_ID: &str = "mangavault.controlled-title-repair-v1";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleRepairPreview {
    pub generated_at: String,
    pub preview_token: String,
    pub active_event_records: usize,
    pub original_preview_matches: usize,
    pub deleted_event_records: usize,
    pub safe_repair_count: usize,
    pub manual_review_count: usize,
    pub excluded_count: usize,
    pub explicit_chapter_count: usize,
    pub reason_counts: BTreeMap<String, usize>,
    pub candidates: Vec<TitleRepairCandidate>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleRepairCandidate {
    pub book_id: i64,
    pub status: String,
    pub current_title: String,
    pub current_chapter: Option<f64>,
    pub current_updated_at: String,
    pub source_path: String,
    pub logical_work_root: Option<String>,
    pub source_basename_or_stem: Option<String>,
    pub legacy_title: Option<String>,
    pub legacy_chapter: Option<f64>,
    pub suggested_title: Option<String>,
    pub suggested_chapter: Option<f64>,
    pub title_matches_legacy: bool,
    pub chapter_matches_legacy: bool,
    pub known_damage_pattern: bool,
    pub source_exists: bool,
    pub logical_root_reliable: bool,
    pub event_number: Option<f64>,
    pub has_explicit_chapter: bool,
    pub manual_status: ManualStatus,
    pub qualification: RepairQualification,
    pub reasons: Vec<String>,
    pub default_selected: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepairQualification {
    SafeRepair,
    ManualReview,
    Excluded,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ManualStatus {
    Manual,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedDatabaseSnapshot {
    pub books: i64,
    pub pages: i64,
    pub bookmarks: i64,
    pub reading_progress: i64,
    pub favorites: i64,
    pub rating_total: i64,
    pub tags: i64,
    pub book_tags: i64,
    pub protected_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppliedTitleRepair {
    pub book_id: i64,
    pub old_title: String,
    pub new_title: String,
    pub old_chapter: Option<f64>,
    pub new_chapter: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleRepairExecutionResult {
    pub preview_token: String,
    pub backup_path: String,
    pub backup_healthy: bool,
    pub backup_recognized: bool,
    pub repaired_count: usize,
    pub quick_check: String,
    pub before: ProtectedDatabaseSnapshot,
    pub after: ProtectedDatabaseSnapshot,
    pub remaining_safe_candidates: usize,
    pub applied: Vec<AppliedTitleRepair>,
}

pub fn preview_title_repairs(database_path: &Path) -> Result<TitleRepairPreview> {
    let connection = open_read_only(database_path)?;
    build_preview(&connection)
}

pub fn protected_database_snapshot(database_path: &Path) -> Result<ProtectedDatabaseSnapshot> {
    let connection = open_read_only(database_path)?;
    protected_snapshot(&connection)
}

pub fn apply_title_repairs(
    database_path: &Path,
    expected_token: &str,
    selected_book_ids: &[i64],
) -> Result<TitleRepairExecutionResult> {
    apply_title_repairs_with_backup(
        database_path,
        expected_token,
        selected_book_ids,
        |database| database.create_backup_with_reason("title-repair"),
    )
}

fn apply_title_repairs_with_backup<F>(
    database_path: &Path,
    expected_token: &str,
    selected_book_ids: &[i64],
    create_backup: F,
) -> Result<TitleRepairExecutionResult>
where
    F: FnOnce(&Database) -> Result<PathBuf>,
{
    let initial_preview = preview_title_repairs(database_path)?;
    ensure_token(expected_token, &initial_preview.preview_token)?;
    let selected_ids = selected_book_ids.iter().copied().collect::<HashSet<_>>();
    if selected_ids.len() != selected_book_ids.len() || selected_ids.is_empty() {
        return Err(MangaVaultError::Message(
            "repair selection must contain unique safe candidate ids".to_string(),
        ));
    }
    ensure_selection_is_safe(&initial_preview, &selected_ids)?;

    let database = Database::open(database_path)?;
    let backup_path = create_backup(&database)?;
    if !healthy_sqlite_file(&backup_path) {
        return Err(MangaVaultError::Message(
            "title repair backup failed health validation".to_string(),
        ));
    }
    let backup_recognized = database
        .list_backup_snapshots()?
        .iter()
        .any(|snapshot| Path::new(&snapshot.snapshot_path) == backup_path);
    if !backup_recognized {
        return Err(MangaVaultError::Message(
            "title repair backup is not registered as a managed snapshot".to_string(),
        ));
    }
    drop(database);

    let mut connection = Connection::open(database_path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let locked_preview = build_preview(&transaction)?;
    ensure_token(expected_token, &locked_preview.preview_token)?;
    ensure_selection_is_safe(&locked_preview, &selected_ids)?;
    let before = protected_snapshot(&transaction)?;
    let stamp = Utc::now().to_rfc3339();
    let config_json = serde_json::json!({
        "previewToken": expected_token,
        "selectedCount": selected_ids.len(),
        "executedAt": stamp,
    })
    .to_string();
    transaction.execute(
        "INSERT INTO metadata_sources(provider_id, name, enabled, priority, config_json, created_at, updated_at)
         VALUES (?1, 'MangaVault controlled title repair', 0, 100, ?2, ?3, ?3)
         ON CONFLICT(provider_id) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at",
        params![REPAIR_SOURCE_ID, config_json, stamp],
    )?;
    let source_id: i64 = transaction.query_row(
        "SELECT id FROM metadata_sources WHERE provider_id=?1",
        params![REPAIR_SOURCE_ID],
        |row| row.get(0),
    )?;

    let records = locked_preview
        .candidates
        .iter()
        .filter(|candidate| selected_ids.contains(&candidate.book_id))
        .cloned()
        .collect::<Vec<_>>();
    let mut applied = Vec::with_capacity(records.len());
    for record in records {
        let new_title = record.suggested_title.clone().ok_or_else(|| {
            MangaVaultError::Message(format!(
                "safe candidate {} has no suggested title",
                record.book_id
            ))
        })?;
        let changed = transaction.execute(
            "UPDATE books
             SET title=?1, sort_title=?2, chapter=?3, updated_at=?4
             WHERE id=?5 AND title=?6
               AND ((chapter IS NULL AND ?7 IS NULL) OR chapter=?7)",
            params![
                new_title,
                normalize_sort_title(&new_title),
                record.suggested_chapter,
                stamp,
                record.book_id,
                record.current_title,
                record.current_chapter,
            ],
        )?;
        if changed != 1 {
            return Err(MangaVaultError::Message(format!(
                "candidate {} changed while the repair transaction was running",
                record.book_id
            )));
        }
        record_history(
            &transaction,
            record.book_id,
            source_id,
            "title",
            Some(&record.current_title),
            Some(&new_title),
            &stamp,
        )?;
        if !numbers_equal(record.current_chapter, record.suggested_chapter) {
            let old_chapter = record.current_chapter.map(number_text);
            let new_chapter = record.suggested_chapter.map(number_text);
            record_history(
                &transaction,
                record.book_id,
                source_id,
                "chapter",
                old_chapter.as_deref(),
                new_chapter.as_deref(),
                &stamp,
            )?;
        }
        applied.push(AppliedTitleRepair {
            book_id: record.book_id,
            old_title: record.current_title,
            new_title,
            old_chapter: record.current_chapter,
            new_chapter: record.suggested_chapter,
        });
    }
    let after_in_transaction = protected_snapshot(&transaction)?;
    if before != after_in_transaction {
        return Err(MangaVaultError::Message(
            "protected library data changed during title repair; transaction rolled back"
                .to_string(),
        ));
    }
    transaction.commit()?;

    let connection = open_read_only(database_path)?;
    let quick_check: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if quick_check != "ok" {
        return Err(MangaVaultError::Message(format!(
            "database quick_check failed after title repair: {quick_check}"
        )));
    }
    let after = protected_snapshot(&connection)?;
    if before != after {
        return Err(MangaVaultError::Message(
            "protected library data differs after title repair".to_string(),
        ));
    }
    let post_preview = build_preview(&connection)?;
    Ok(TitleRepairExecutionResult {
        preview_token: expected_token.to_string(),
        backup_path: backup_path.to_string_lossy().to_string(),
        backup_healthy: true,
        backup_recognized,
        repaired_count: applied.len(),
        quick_check,
        before,
        after,
        remaining_safe_candidates: post_preview.safe_repair_count,
        applied,
    })
}

fn build_preview(connection: &Connection) -> Result<TitleRepairPreview> {
    let mut statement = connection.prepare(
        "SELECT b.id, b.title, b.chapter, b.path, b.format, b.status, b.updated_at,
                EXISTS(
                    SELECT 1 FROM metadata_history mh
                    WHERE mh.book_id=b.id AND mh.source_id IS NULL AND mh.field_name='title'
                )
         FROM books b
         ORDER BY b.id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PreviewRow {
            book_id: row.get(0)?,
            current_title: row.get(1)?,
            current_chapter: row.get(2)?,
            source_path: row.get(3)?,
            format: row.get(4)?,
            status: row.get(5)?,
            updated_at: row.get(6)?,
            has_manual_title_history: row.get::<_, i64>(7)? != 0,
        })
    })?;

    let mut candidates = Vec::new();
    for row in rows {
        if let Some(candidate) = candidate_from_row(row?) {
            candidates.push(candidate);
        }
    }
    let mut hasher = Hasher::new();
    for candidate in &candidates {
        hash_candidate(&mut hasher, candidate);
    }
    let active_event_records = candidates
        .iter()
        .filter(|candidate| candidate.status != "deleted")
        .count();
    let original_preview_matches = candidates
        .iter()
        .filter(|candidate| candidate.status != "deleted" && candidate.known_damage_pattern)
        .count();
    let deleted_event_records = candidates
        .iter()
        .filter(|candidate| candidate.status == "deleted")
        .count();
    let safe_repair_count = count_qualification(&candidates, RepairQualification::SafeRepair);
    let manual_review_count = count_qualification(&candidates, RepairQualification::ManualReview);
    let excluded_count = count_qualification(&candidates, RepairQualification::Excluded);
    let explicit_chapter_count = candidates
        .iter()
        .filter(|candidate| candidate.has_explicit_chapter)
        .count();
    let mut reason_counts = BTreeMap::new();
    for reason in candidates.iter().flat_map(|candidate| &candidate.reasons) {
        *reason_counts.entry(reason.clone()).or_insert(0) += 1;
    }
    Ok(TitleRepairPreview {
        generated_at: Utc::now().to_rfc3339(),
        preview_token: hasher.finalize().to_hex().to_string(),
        active_event_records,
        original_preview_matches,
        deleted_event_records,
        safe_repair_count,
        manual_review_count,
        excluded_count,
        explicit_chapter_count,
        reason_counts,
        candidates,
    })
}

struct PreviewRow {
    book_id: i64,
    current_title: String,
    current_chapter: Option<f64>,
    source_path: String,
    format: String,
    status: String,
    updated_at: String,
    has_manual_title_history: bool,
}

fn candidate_from_row(row: PreviewRow) -> Option<TitleRepairCandidate> {
    let source_path = PathBuf::from(&row.source_path);
    let source_exists = source_path.exists();
    let source_basename_or_stem = source_name(&source_path, &row.format);
    let logical_root = if row.format.eq_ignore_ascii_case("folder") {
        logical_book_root_for_image_dir(&source_path)
    } else {
        source_path.clone()
    };
    let logical_name = source_name(&logical_root, &row.format);
    let event_number = logical_name.as_deref().and_then(comic_market_event_number);
    let legacy = logical_name.as_deref().map(legacy_parse_title);
    if event_number.is_none()
        || !numbers_equal(
            legacy.as_ref().and_then(|value| value.chapter),
            event_number,
        )
    {
        return None;
    }
    let logical_root_reliable = logical_name
        .as_deref()
        .is_some_and(|name| !is_disallowed_source_name(name) && !looks_like_chapter_only(name));
    let suggested = logical_name
        .as_deref()
        .filter(|_| source_exists && logical_root_reliable)
        .map(parse_title);
    let legacy_title = legacy.as_ref().map(|value| value.title.clone());
    let legacy_chapter = legacy.as_ref().and_then(|value| value.chapter);
    let suggested_title = suggested.as_ref().map(|value| value.title.clone());
    let suggested_chapter = suggested.as_ref().and_then(|value| value.chapter);
    let title_matches_legacy = legacy_title.as_deref() == Some(row.current_title.as_str());
    let chapter_matches_legacy = numbers_equal(row.current_chapter, legacy_chapter);
    let known_damage_pattern = has_known_empty_parentheses(&row.current_title);
    let manual_status = if row.has_manual_title_history {
        ManualStatus::Manual
    } else {
        ManualStatus::Unknown
    };
    let has_explicit_chapter = suggested_chapter.is_some();
    let (qualification, reasons) = qualify_candidate(
        &row,
        source_exists,
        logical_root_reliable,
        suggested_title.as_deref(),
        suggested_chapter,
        title_matches_legacy,
        chapter_matches_legacy,
        known_damage_pattern,
    );

    Some(TitleRepairCandidate {
        book_id: row.book_id,
        status: row.status,
        current_title: row.current_title,
        current_chapter: row.current_chapter,
        current_updated_at: row.updated_at,
        source_path: row.source_path,
        logical_work_root: logical_root.to_str().map(str::to_string),
        source_basename_or_stem,
        legacy_title,
        legacy_chapter,
        suggested_title,
        suggested_chapter,
        title_matches_legacy,
        chapter_matches_legacy,
        known_damage_pattern,
        source_exists,
        logical_root_reliable,
        event_number,
        has_explicit_chapter,
        manual_status,
        qualification,
        reasons,
        default_selected: qualification == RepairQualification::SafeRepair,
    })
}

#[allow(clippy::too_many_arguments)]
fn qualify_candidate(
    row: &PreviewRow,
    source_exists: bool,
    logical_root_reliable: bool,
    suggested_title: Option<&str>,
    suggested_chapter: Option<f64>,
    title_matches_legacy: bool,
    chapter_matches_legacy: bool,
    known_damage_pattern: bool,
) -> (RepairQualification, Vec<String>) {
    if row.status == "deleted" {
        return (
            RepairQualification::Excluded,
            vec!["deleted_record".to_string()],
        );
    }
    if !source_exists {
        return (
            RepairQualification::ManualReview,
            vec!["source_path_missing".to_string()],
        );
    }
    if !logical_root_reliable || suggested_title.is_none() {
        return (
            RepairQualification::ManualReview,
            vec!["logical_work_root_unreliable".to_string()],
        );
    }
    if row.has_manual_title_history {
        return (
            RepairQualification::ManualReview,
            vec!["manual_title_history".to_string()],
        );
    }
    if row.current_title == suggested_title.unwrap()
        && numbers_equal(row.current_chapter, suggested_chapter)
    {
        return (
            RepairQualification::Excluded,
            vec!["already_repaired".to_string()],
        );
    }
    if !known_damage_pattern {
        return (
            RepairQualification::ManualReview,
            vec!["known_damage_pattern_mismatch".to_string()],
        );
    }
    let mut reasons = Vec::new();
    if !title_matches_legacy {
        reasons.push("legacy_title_mismatch".to_string());
    }
    if !chapter_matches_legacy {
        reasons.push("legacy_chapter_mismatch".to_string());
    }
    if reasons.is_empty() {
        (
            RepairQualification::SafeRepair,
            vec!["legacy_result_exact_match".to_string()],
        )
    } else {
        (RepairQualification::ManualReview, reasons)
    }
}

pub fn legacy_parse_title(file_name: &str) -> ParsedTitle {
    let cleaned = file_name.replace(['_', '.'], " ");
    let author_re = Regex::new(r"^\[(?P<author>[^\]]+)\]\s*(?P<title>.+)$").unwrap();
    let volume_re = Regex::new(r"(?i)\b(?:vol(?:ume)?|v)\.?\s*(?P<num>\d+(?:\.\d+)?)").unwrap();
    let chapter_re = Regex::new(r"(?i)\b(?:ch(?:apter)?|c)\.?\s*(?P<num>\d+(?:\.\d+)?)").unwrap();
    let cn_volume_re = Regex::new(r"(?:第\s*)?(?P<num>\d+(?:\.\d+)?)\s*[卷冊册]").unwrap();
    let cn_chapter_re = Regex::new(r"(?:第\s*)?(?P<num>\d+(?:\.\d+)?)\s*[话話章回]").unwrap();
    let author = author_re.captures(&cleaned).and_then(|captures| {
        captures
            .name("author")
            .map(|value| value.as_str().trim().to_string())
    });
    let mut title = author_re
        .captures(&cleaned)
        .and_then(|captures| {
            captures
                .name("title")
                .map(|value| value.as_str().to_string())
        })
        .unwrap_or(cleaned);
    let volume =
        capture_number(&volume_re, &title).or_else(|| capture_number(&cn_volume_re, &title));
    let chapter =
        capture_number(&chapter_re, &title).or_else(|| capture_number(&cn_chapter_re, &title));
    title = volume_re.replace_all(&title, "").to_string();
    title = chapter_re.replace_all(&title, "").to_string();
    title = cn_volume_re.replace_all(&title, "").to_string();
    title = cn_chapter_re.replace_all(&title, "").to_string();
    title = title
        .replace(['-', '[', ']'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if title.is_empty() {
        title = "Untitled".to_string();
    }
    ParsedTitle {
        title,
        author,
        volume,
        chapter,
    }
}

fn capture_number(regex: &Regex, value: &str) -> Option<f64> {
    regex
        .captures(value)
        .and_then(|captures| captures.name("num"))
        .and_then(|number| number.as_str().parse::<f64>().ok())
}

fn ensure_token(expected: &str, current: &str) -> Result<()> {
    if expected == current {
        Ok(())
    } else {
        Err(MangaVaultError::Message(
            "title repair preview token is stale".to_string(),
        ))
    }
}

fn ensure_selection_is_safe(
    preview: &TitleRepairPreview,
    selected_ids: &HashSet<i64>,
) -> Result<()> {
    let safe_ids = preview
        .candidates
        .iter()
        .filter(|candidate| candidate.qualification == RepairQualification::SafeRepair)
        .map(|candidate| candidate.book_id)
        .collect::<HashSet<_>>();
    if selected_ids.is_subset(&safe_ids) {
        Ok(())
    } else {
        Err(MangaVaultError::Message(
            "repair selection contains a record that is not strictly qualified".to_string(),
        ))
    }
}

fn record_history(
    connection: &Connection,
    book_id: i64,
    source_id: i64,
    field_name: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
    stamp: &str,
) -> Result<()> {
    connection.execute(
        "INSERT INTO metadata_history(book_id, source_id, field_name, old_value, new_value, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![book_id, source_id, field_name, old_value, new_value, stamp],
    )?;
    Ok(())
}

fn protected_snapshot(connection: &Connection) -> Result<ProtectedDatabaseSnapshot> {
    let mut hasher = Hasher::new();
    for query in [
        "SELECT id, library_id, series_id, author, volume, path, format, file_size, modified_at,
                page_count, cover_page_index, cover_cache_key, is_favorite, rating, status,
                imported_at, last_read_at, checksum
         FROM books ORDER BY id",
        "SELECT * FROM series ORDER BY id",
        "SELECT * FROM chapters ORDER BY id",
        "SELECT * FROM pages ORDER BY id",
        "SELECT * FROM tags ORDER BY id",
        "SELECT * FROM book_tags ORDER BY book_id, tag_id",
        "SELECT * FROM reading_progress ORDER BY book_id",
        "SELECT * FROM bookmarks ORDER BY id",
        "SELECT * FROM reading_history ORDER BY id",
        "SELECT * FROM thumbnails ORDER BY id",
    ] {
        hash_query(connection, query, &mut hasher)?;
    }
    Ok(ProtectedDatabaseSnapshot {
        books: table_count(connection, "books")?,
        pages: table_count(connection, "pages")?,
        bookmarks: table_count(connection, "bookmarks")?,
        reading_progress: table_count(connection, "reading_progress")?,
        favorites: connection.query_row(
            "SELECT count(*) FROM books WHERE is_favorite=1",
            [],
            |row| row.get(0),
        )?,
        rating_total: connection.query_row(
            "SELECT coalesce(sum(rating), 0) FROM books",
            [],
            |row| row.get(0),
        )?,
        tags: table_count(connection, "tags")?,
        book_tags: table_count(connection, "book_tags")?,
        protected_fingerprint: hasher.finalize().to_hex().to_string(),
    })
}

fn table_count(connection: &Connection, table: &str) -> rusqlite::Result<i64> {
    connection.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
}

fn hash_query(connection: &Connection, query: &str, hasher: &mut Hasher) -> Result<()> {
    let mut statement = connection.prepare(query)?;
    let column_count = statement.column_count();
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        for index in 0..column_count {
            match row.get_ref(index)? {
                ValueRef::Null => hasher.update(&[0]),
                ValueRef::Integer(value) => {
                    hasher.update(&[1]);
                    hasher.update(&value.to_le_bytes())
                }
                ValueRef::Real(value) => {
                    hasher.update(&[2]);
                    hasher.update(&value.to_le_bytes())
                }
                ValueRef::Text(value) => {
                    hasher.update(&[3]);
                    hasher.update(&(value.len() as u64).to_le_bytes());
                    hasher.update(value)
                }
                ValueRef::Blob(value) => {
                    hasher.update(&[4]);
                    hasher.update(&(value.len() as u64).to_le_bytes());
                    hasher.update(value)
                }
            };
        }
    }
    Ok(())
}

fn open_read_only(database_path: &Path) -> Result<Connection> {
    Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(Into::into)
}

fn source_name(path: &Path, format: &str) -> Option<String> {
    let name = if format.eq_ignore_ascii_case("folder") {
        path.file_name()
    } else {
        path.file_stem()
    }?;
    name.to_str().map(str::to_string)
}

fn comic_market_event_number(value: &str) -> Option<f64> {
    Regex::new(r"(?i)(?:\(|（)C(?P<num>\d{2,3})(?:\)|）)")
        .unwrap()
        .captures(value)
        .and_then(|captures| captures.name("num"))
        .and_then(|number| number.as_str().parse().ok())
}

fn has_known_empty_parentheses(value: &str) -> bool {
    let trimmed = value.trim_start();
    trimmed.starts_with("()") || trimmed.starts_with("（）")
}

fn looks_like_chapter_only(value: &str) -> bool {
    Regex::new(
        r"(?i)^\s*(?:(?:chapter|ch)\.?\s*\d+(?:\.\d+)?|第?\s*\d+(?:\.\d+)?\s*[话話章篇回])\s*$",
    )
    .unwrap()
    .is_match(value)
}

fn is_disallowed_source_name(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized == "original"
        || normalized == "waifu2x"
        || normalized.starts_with("waifu2x-")
        || normalized.starts_with("realesrgan")
        || normalized.starts_with("real-esrgan")
        || normalized.starts_with("realcugan")
        || normalized.starts_with("anime4k")
        || normalized.starts_with("swinir")
        || normalized.starts_with("upscayl")
}

fn numbers_equal(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => (left - right).abs() < f64::EPSILON,
        (None, None) => true,
        _ => false,
    }
}

fn number_text(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

fn count_qualification(
    candidates: &[TitleRepairCandidate],
    qualification: RepairQualification,
) -> usize {
    candidates
        .iter()
        .filter(|candidate| candidate.qualification == qualification)
        .count()
}

fn hash_candidate(hasher: &mut Hasher, candidate: &TitleRepairCandidate) {
    hasher.update(&candidate.book_id.to_le_bytes());
    for value in [
        candidate.status.as_str(),
        candidate.current_title.as_str(),
        candidate.current_updated_at.as_str(),
        candidate.source_path.as_str(),
        candidate.logical_work_root.as_deref().unwrap_or_default(),
        candidate.legacy_title.as_deref().unwrap_or_default(),
        candidate.suggested_title.as_deref().unwrap_or_default(),
    ] {
        hasher.update(&(value.len() as u64).to_le_bytes());
        hasher.update(value.as_bytes());
    }
    for number in [
        candidate.current_chapter,
        candidate.legacy_chapter,
        candidate.suggested_chapter,
    ] {
        hasher.update(&number.unwrap_or(f64::NAN).to_le_bytes());
    }
    hasher.update(&[
        u8::from(candidate.source_exists),
        u8::from(candidate.logical_root_reliable),
        u8::from(candidate.manual_status == ManualStatus::Manual),
    ]);
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use rusqlite::params;

    use super::*;
    use crate::db::{ScannedBook, ScannedPage};

    #[test]
    fn legacy_parser_exactly_reproduces_the_c_event_damage() {
        let source = "[汉化组](C107)[作者] K-ON! 23.4 1-4 第3话";
        let legacy = legacy_parse_title(source);
        let corrected = parse_title(source);
        assert_eq!(legacy.title, "() 作者 K ON! 23 4 1 4");
        assert_eq!(legacy.chapter, Some(107.0));
        assert_eq!(corrected.title, source);
        assert_eq!(corrected.chapter, Some(3.0));
    }

    #[test]
    fn strict_preview_is_read_only_and_qualifies_only_an_exact_legacy_match() {
        let fixture = repair_fixture("(C107) [作者] K-ON! 23.4 1-4");
        let preview = preview_title_repairs(&fixture.database_path).unwrap();
        assert_eq!(preview.active_event_records, 1);
        assert_eq!(preview.safe_repair_count, 1);
        let candidate = &preview.candidates[0];
        assert_eq!(
            candidate.legacy_title.as_deref(),
            Some("() 作者 K ON! 23 4 1 4")
        );
        assert_eq!(
            candidate.current_title,
            candidate.legacy_title.as_deref().unwrap()
        );
        assert!(candidate.title_matches_legacy);
        assert!(candidate.chapter_matches_legacy);
        assert_eq!(candidate.qualification, RepairQualification::SafeRepair);
        assert!(candidate.default_selected);

        let unchanged = read_title(&fixture.database_path, fixture.book_id);
        assert_eq!(unchanged, "() 作者 K ON! 23 4 1 4");
    }

    #[test]
    fn title_or_chapter_mismatches_require_manual_review() {
        let fixture = repair_fixture("(C100) [作者] 作品");
        let connection = Connection::open(&fixture.database_path).unwrap();
        connection
            .execute(
                "UPDATE books SET title='() 用户改过的标题', chapter=99 WHERE id=?1",
                params![fixture.book_id],
            )
            .unwrap();
        drop(connection);
        let preview = preview_title_repairs(&fixture.database_path).unwrap();
        let candidate = &preview.candidates[0];
        assert_eq!(candidate.qualification, RepairQualification::ManualReview);
        assert!(candidate
            .reasons
            .contains(&"legacy_title_mismatch".to_string()));
        assert!(candidate
            .reasons
            .contains(&"legacy_chapter_mismatch".to_string()));
    }

    #[test]
    fn stale_tokens_are_rejected_before_backup() {
        let fixture = repair_fixture("(C101) [作者] 作品");
        let preview = preview_title_repairs(&fixture.database_path).unwrap();
        let backup_called = Cell::new(false);
        let error = apply_title_repairs_with_backup(
            &fixture.database_path,
            "stale-token",
            &[fixture.book_id],
            |_| {
                backup_called.set(true);
                unreachable!()
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("stale"));
        assert!(!backup_called.get());
        assert_eq!(preview.safe_repair_count, 1);
        assert_eq!(
            read_title(&fixture.database_path, fixture.book_id),
            "() 作者 作品"
        );
    }

    #[test]
    fn backup_failures_abort_without_updating_books() {
        let fixture = repair_fixture("(C102) [作者] 作品");
        let preview = preview_title_repairs(&fixture.database_path).unwrap();
        let error = apply_title_repairs_with_backup(
            &fixture.database_path,
            &preview.preview_token,
            &[fixture.book_id],
            |_| {
                Err(MangaVaultError::Message(
                    "simulated backup failure".to_string(),
                ))
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("backup failure"));
        assert_eq!(
            read_title(&fixture.database_path, fixture.book_id),
            "() 作者 作品"
        );
    }

    #[test]
    fn controlled_repair_is_transactional_logged_and_idempotent() {
        let fixture = repair_fixture("(C107) [作者] 作品 第3话");
        let preview = preview_title_repairs(&fixture.database_path).unwrap();
        let result = apply_title_repairs(
            &fixture.database_path,
            &preview.preview_token,
            &[fixture.book_id],
        )
        .unwrap();
        assert_eq!(result.repaired_count, 1);
        assert_eq!(result.applied[0].new_title, "(C107) [作者] 作品 第3话");
        assert_eq!(result.applied[0].new_chapter, Some(3.0));
        assert_eq!(result.before, result.after);
        assert_eq!(result.quick_check, "ok");
        assert!(result.backup_healthy);
        assert!(result.backup_recognized);
        assert_eq!(result.remaining_safe_candidates, 0);

        let post = preview_title_repairs(&fixture.database_path).unwrap();
        assert_eq!(post.safe_repair_count, 0);
        let rerun = apply_title_repairs(
            &fixture.database_path,
            &preview.preview_token,
            &[fixture.book_id],
        )
        .unwrap_err();
        assert!(rerun.to_string().contains("stale"));
        let connection = Connection::open(&fixture.database_path).unwrap();
        let history_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM metadata_history mh
                 JOIN metadata_sources ms ON ms.id=mh.source_id
                 WHERE mh.book_id=?1 AND ms.provider_id=?2",
                params![fixture.book_id, REPAIR_SOURCE_ID],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(history_count, 2);
    }

    struct RepairFixture {
        _temp: tempfile::TempDir,
        database_path: PathBuf,
        book_id: i64,
    }

    fn repair_fixture(source_name: &str) -> RepairFixture {
        let temp = tempfile::tempdir().unwrap();
        let library_root = temp.path().join("library");
        let work = library_root.join(source_name);
        std::fs::create_dir_all(&work).unwrap();
        std::fs::write(work.join("001.webp"), b"page").unwrap();
        let database_path = temp.path().join("test.sqlite3");
        let mut database = Database::open(&database_path).unwrap();
        database.migrate().unwrap();
        let library = database.upsert_library(&library_root, true).unwrap();
        let parsed = parse_title(source_name);
        let book_id = database
            .upsert_scanned_book(&ScannedBook {
                library_id: library.id,
                title: parsed.title,
                sort_title: normalize_sort_title(source_name),
                author: parsed.author,
                volume: parsed.volume,
                chapter: parsed.chapter,
                path: work.to_string_lossy().to_string(),
                format: "folder".to_string(),
                file_size: 4,
                modified_at: None,
                page_count: 1,
                checksum: Some("fixture".to_string()),
                pages: vec![ScannedPage {
                    page_index: 0,
                    source_path: "001.webp".to_string(),
                    width: None,
                    height: None,
                    byte_size: Some(4),
                }],
            })
            .unwrap();
        let legacy = legacy_parse_title(source_name);
        drop(database);
        let connection = Connection::open(&database_path).unwrap();
        connection
            .execute(
                "UPDATE books SET title=?1, sort_title=?2, chapter=?3 WHERE id=?4",
                params![
                    legacy.title,
                    normalize_sort_title(&legacy.title),
                    legacy.chapter,
                    book_id
                ],
            )
            .unwrap();
        drop(connection);
        RepairFixture {
            _temp: temp,
            database_path,
            book_id,
        }
    }

    fn read_title(database_path: &Path, book_id: i64) -> String {
        Connection::open(database_path)
            .unwrap()
            .query_row(
                "SELECT title FROM books WHERE id=?1",
                params![book_id],
                |row| row.get(0),
            )
            .unwrap()
    }
}
