use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use walkdir::{DirEntry, WalkDir};

use crate::error::{MangaVaultError, Result};
use crate::models::ExternalMatchBook;
use crate::scanner::logical_book_root_for_image_dir;

const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DISCOVERY_ENTRIES: usize = 250_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JmComicSourceCandidate {
    pub database_path: String,
    pub data_directory: String,
    pub download_count: usize,
    pub existing_source_count: usize,
    pub modified_at: Option<String>,
    pub healthy: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JmComicMatchItem {
    pub jm_id: String,
    pub source_title: String,
    pub source_path: String,
    pub logical_root_path: String,
    pub source_path_exists: bool,
    pub book_id: Option<i64>,
    pub current_title: Option<String>,
    pub status: String,
    pub match_method: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JmComicMatchPreview {
    pub database_path: String,
    pub source_records: usize,
    pub matched: usize,
    pub unmatched: usize,
    pub ambiguous: usize,
    pub missing_source: usize,
    pub generated_at: String,
    pub preview_token: String,
    pub read_only: bool,
    pub items: Vec<JmComicMatchItem>,
}

#[derive(Debug, Clone)]
struct DownloadRecord {
    jm_id: String,
    title: String,
    save_path: String,
    convert_path: String,
}

pub fn discover_sources(
    search_roots: &[PathBuf],
    excluded_roots: &[PathBuf],
) -> Vec<JmComicSourceCandidate> {
    let mut databases = HashSet::new();
    let mut seen_roots = HashSet::new();
    for root in search_roots {
        if !seen_roots.insert(path_key(root)) {
            continue;
        }
        if !root.is_dir() {
            continue;
        }
        let mut visited = 0usize;
        let walker = WalkDir::new(root)
            .max_depth(8)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| should_visit(entry, excluded_roots));
        for entry in walker.filter_map(std::result::Result::ok) {
            visited += 1;
            if visited > MAX_DISCOVERY_ENTRIES {
                break;
            }
            if entry.file_type().is_file()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.eq_ignore_ascii_case("download.db"))
            {
                databases.insert(entry.path().to_path_buf());
            }
        }
        if visited > MAX_DISCOVERY_ENTRIES {
            continue;
        }
    }

    let mut candidates = databases
        .into_iter()
        .map(|path| inspect_source(&path))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .healthy
            .cmp(&left.healthy)
            .then_with(|| right.existing_source_count.cmp(&left.existing_source_count))
            .then_with(|| right.download_count.cmp(&left.download_count))
            .then_with(|| left.database_path.cmp(&right.database_path))
    });
    candidates
}

pub fn default_discovery_roots(library_paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for path in library_paths {
        if let Some(root) = volume_root(path) {
            push_unique_path(&mut roots, root);
        }
    }
    if let Some(home) = dirs::home_dir() {
        push_unique_path(&mut roots, home);
    }
    if let Ok(current) = std::env::current_dir() {
        push_unique_path(&mut roots, current);
    }
    roots
}

pub fn inspect_source(path: &Path) -> JmComicSourceCandidate {
    let modified_at = path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(DateTime::<Utc>::from)
        .map(|value| value.to_rfc3339());
    let result = snapshot_records(path);
    match result {
        Ok((_, records)) => JmComicSourceCandidate {
            database_path: path.to_string_lossy().to_string(),
            data_directory: path.parent().unwrap_or(path).to_string_lossy().to_string(),
            download_count: records.len(),
            existing_source_count: records
                .iter()
                .filter(|record| record_paths(record).iter().any(|path| path.exists()))
                .count(),
            modified_at,
            healthy: true,
            message: None,
        },
        Err(error) => JmComicSourceCandidate {
            database_path: path.to_string_lossy().to_string(),
            data_directory: path.parent().unwrap_or(path).to_string_lossy().to_string(),
            download_count: 0,
            existing_source_count: 0,
            modified_at,
            healthy: false,
            message: Some(error.to_string()),
        },
    }
}

pub fn preview_matches(path: &Path, books: &[ExternalMatchBook]) -> Result<JmComicMatchPreview> {
    let (database_path, records) = snapshot_records(path)?;
    let mut books_by_root: HashMap<String, Vec<&ExternalMatchBook>> = HashMap::new();
    for book in books {
        let root = logical_book_root_for_image_dir(Path::new(&book.path));
        books_by_root.entry(path_key(&root)).or_default().push(book);
    }

    let mut items = Vec::with_capacity(records.len());
    for record in records {
        let paths = record_paths(&record);
        let existing_paths = paths
            .iter()
            .filter(|candidate| candidate.exists())
            .cloned()
            .collect::<Vec<_>>();
        let preferred_path = existing_paths
            .first()
            .or_else(|| paths.first())
            .cloned()
            .unwrap_or_default();
        let logical_root = logical_book_root_for_image_dir(&preferred_path);
        let mut matches = HashMap::<i64, &ExternalMatchBook>::new();
        for source in &paths {
            let root = logical_book_root_for_image_dir(source);
            if let Some(found) = books_by_root.get(&path_key(&root)) {
                for book in found {
                    matches.insert(book.id, *book);
                }
            }
        }
        let (status, matched_book) = if existing_paths.is_empty() {
            ("missing_source", None)
        } else if matches.len() == 1 {
            ("matched", matches.values().next().copied())
        } else if matches.len() > 1 {
            ("ambiguous", None)
        } else {
            ("unmatched", None)
        };
        items.push(JmComicMatchItem {
            jm_id: record.jm_id,
            source_title: record.title,
            source_path: preferred_path.to_string_lossy().to_string(),
            logical_root_path: logical_root.to_string_lossy().to_string(),
            source_path_exists: !existing_paths.is_empty(),
            book_id: matched_book.map(|book| book.id),
            current_title: matched_book.map(|book| book.title.clone()),
            status: status.to_string(),
            match_method: matched_book.map(|_| "exact_logical_root".to_string()),
        });
    }
    items.sort_by(|left, right| {
        status_rank(&left.status)
            .cmp(&status_rank(&right.status))
            .then_with(|| left.source_title.cmp(&right.source_title))
    });
    let preview_token = match_preview_token(&database_path, &items);
    Ok(JmComicMatchPreview {
        database_path,
        source_records: items.len(),
        matched: items.iter().filter(|item| item.status == "matched").count(),
        unmatched: items
            .iter()
            .filter(|item| item.status == "unmatched")
            .count(),
        ambiguous: items
            .iter()
            .filter(|item| item.status == "ambiguous")
            .count(),
        missing_source: items
            .iter()
            .filter(|item| item.status == "missing_source")
            .count(),
        generated_at: Utc::now().to_rfc3339(),
        preview_token,
        read_only: true,
        items,
    })
}

fn match_preview_token(database_path: &str, items: &[JmComicMatchItem]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(database_path.as_bytes());
    for item in items {
        hasher.update(item.jm_id.as_bytes());
        hasher.update(item.status.as_bytes());
        hasher.update(item.logical_root_path.as_bytes());
        hasher.update(&item.book_id.unwrap_or_default().to_le_bytes());
    }
    hasher.finalize().to_hex().to_string()
}

fn snapshot_records(path: &Path) -> Result<(String, Vec<DownloadRecord>)> {
    let metadata = path.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES {
        return Err(MangaVaultError::Message(
            "JMComic database is not a regular file or exceeds the 512 MiB safety limit"
                .to_string(),
        ));
    }
    let source = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let mut snapshot = Connection::open_in_memory()?;
    {
        let backup = Backup::new(&source, &mut snapshot)?;
        backup.run_to_completion(128, Duration::from_millis(1), None)?;
    }
    drop(source);
    validate_snapshot(&snapshot)?;
    let mut stmt = snapshot.prepare(
        "SELECT bookId, coalesce(title, ''), coalesce(savePath, ''), coalesce(convertPath, '')
         FROM download ORDER BY tick DESC, bookId ASC",
    )?;
    let records = stmt
        .query_map([], |row| {
            Ok(DownloadRecord {
                jm_id: row.get(0)?,
                title: row.get(1)?,
                save_path: row.get(2)?,
                convert_path: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok((path.to_string_lossy().to_string(), records))
}

fn validate_snapshot(connection: &Connection) -> Result<()> {
    let quick_check: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if quick_check != "ok" {
        return Err(MangaVaultError::Message(format!(
            "JMComic database quick_check failed: {quick_check}"
        )));
    }
    let columns = connection
        .prepare("PRAGMA table_info(download)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<HashSet<_>, _>>()?;
    for required in ["bookId", "title", "savePath", "convertPath", "tick"] {
        if !columns.contains(required) {
            return Err(MangaVaultError::Message(format!(
                "unsupported JMComic download database: missing {required}"
            )));
        }
    }
    Ok(())
}

fn record_paths(record: &DownloadRecord) -> Vec<PathBuf> {
    let mut values = Vec::new();
    for raw in [&record.save_path, &record.convert_path] {
        if raw.trim().is_empty() {
            continue;
        }
        let path = native_path(raw);
        if !values.contains(&path) {
            values.push(path);
        }
    }
    values
}

fn native_path(raw: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(raw.replace('/', "\\"))
    } else {
        PathBuf::from(raw)
    }
}

fn path_key(path: &Path) -> String {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let text = normalized.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    {
        text.strip_prefix(r"\\?\UNC\")
            .map(|rest| format!(r"\\{rest}"))
            .or_else(|| text.strip_prefix(r"\\?\").map(str::to_string))
            .unwrap_or(text)
            .trim_end_matches('\\')
            .to_lowercase()
    }
    #[cfg(not(windows))]
    text.trim_end_matches('\\').to_string()
}

fn status_rank(status: &str) -> u8 {
    match status {
        "matched" => 0,
        "unmatched" => 1,
        "ambiguous" => 2,
        _ => 3,
    }
}

fn volume_root(path: &Path) -> Option<PathBuf> {
    let mut components = path.components();
    let first = components.next()?;
    let mut root = PathBuf::from(first.as_os_str());
    if let Some(second) = components.next() {
        if matches!(second, std::path::Component::RootDir) {
            root.push(second.as_os_str());
        }
    }
    Some(root)
}

fn should_visit(entry: &DirEntry, excluded_roots: &[PathBuf]) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    if entry.file_type().is_dir()
        && excluded_roots
            .iter()
            .any(|excluded| path_key(entry.path()) == path_key(excluded))
    {
        return false;
    }
    let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
    !matches!(
        name.as_str(),
        "$recycle.bin"
            | "system volume information"
            | "windows"
            | "node_modules"
            | ".git"
            | "target"
            | "thumbnails"
            | "reader-pages"
    )
}

fn push_unique_path(paths: &mut Vec<PathBuf>, value: PathBuf) {
    let key = path_key(&value);
    if !paths.iter().any(|path| path_key(path) == key) {
        paths.push(value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn create_download_db(path: &Path, rows: &[(&str, &str, &Path, &Path)]) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE download(
                    bookId varchar PRIMARY KEY, title varchar, savePath varchar,
                    convertPath varchar, tick INT
                 );",
            )
            .unwrap();
        for (book_id, title, save_path, convert_path) in rows {
            connection
                .execute(
                    "INSERT INTO download VALUES (?1, ?2, ?3, ?4, 1)",
                    params![
                        book_id,
                        title,
                        save_path.to_string_lossy(),
                        convert_path.to_string_lossy()
                    ],
                )
                .unwrap();
        }
    }

    #[test]
    fn reads_a_consistent_snapshot_and_matches_logical_roots() {
        let dir = tempfile::tempdir().unwrap();
        let work = dir.path().join("Artist").join("Work");
        let original = work.join("original");
        let enhanced = work.join("waifu2x");
        std::fs::create_dir_all(&original).unwrap();
        let database = dir.path().join("download.db");
        create_download_db(
            &database,
            &[("12345", "Source title", &original, &enhanced)],
        );

        let preview = preview_matches(
            &database,
            &[ExternalMatchBook {
                id: 7,
                title: "Local title".to_string(),
                path: work.to_string_lossy().to_string(),
            }],
        )
        .unwrap();

        assert!(preview.read_only);
        assert_eq!(preview.matched, 1);
        assert_eq!(preview.items[0].jm_id, "12345");
        assert_eq!(preview.items[0].book_id, Some(7));
        assert_eq!(
            preview.items[0].match_method.as_deref(),
            Some("exact_logical_root")
        );
    }

    #[test]
    fn reports_missing_sources_without_title_guessing() {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("download.db");
        create_download_db(
            &database,
            &[(
                "67890",
                "Unrelated title",
                &dir.path().join("gone").join("original"),
                &dir.path().join("gone").join("waifu2x"),
            )],
        );

        let preview = preview_matches(&database, &[]).unwrap();

        assert_eq!(preview.missing_source, 1);
        assert_eq!(preview.items[0].status, "missing_source");
        assert!(preview.items[0].book_id.is_none());
    }

    #[test]
    fn rejects_an_unrelated_sqlite_database() {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("download.db");
        Connection::open(&database)
            .unwrap()
            .execute("CREATE TABLE other(value TEXT)", [])
            .unwrap();

        let error = preview_matches(&database, &[]).unwrap_err().to_string();
        assert!(error.contains("missing bookId"));
    }

    #[test]
    fn discovers_only_valid_download_database_names() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("app").join("data");
        std::fs::create_dir_all(&data).unwrap();
        create_download_db(&data.join("download.db"), &[]);
        create_download_db(&data.join("copy.sqlite"), &[]);

        let found = discover_sources(&[dir.path().to_path_buf()], &[]);

        assert_eq!(found.len(), 1);
        assert!(found[0].healthy);
        assert!(found[0].database_path.ends_with("download.db"));
    }

    #[test]
    fn discovery_skips_registered_manga_roots() {
        let dir = tempfile::tempdir().unwrap();
        let library = dir.path().join("library");
        let app = dir.path().join("jmcomic").join("data");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::create_dir_all(&app).unwrap();
        create_download_db(&library.join("download.db"), &[]);
        create_download_db(&app.join("download.db"), &[]);

        let found = discover_sources(&[dir.path().to_path_buf()], std::slice::from_ref(&library));

        assert_eq!(found.len(), 1);
        assert!(found[0].database_path.contains("jmcomic"));
    }
}
