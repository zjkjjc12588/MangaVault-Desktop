use mangavault_desktop::db::{Database, ScannedBook, ScannedPage, ThumbnailRecord};
use mangavault_desktop::models::{
    BookQuery, ExternalBookMetadata, ExternalChapterMetadata, ExternalIdentityCandidate,
    MetadataUpdate,
};

#[test]
fn migrates_and_seeds_database() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    db.seed_defaults().unwrap();
    let settings = db.get_settings().unwrap();
    assert_eq!(settings["reader.mode"], "single");
}

#[test]
fn migrated_database_passes_sqlite_quick_check() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    db.seed_defaults().unwrap();

    let health = db.health().unwrap();
    assert!(health.ok);
    assert_eq!(health.message, "ok");
}

#[test]
fn creates_disabled_jmcomic_metadata_schema() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();

    let settings = db.get_settings().unwrap();
    assert_eq!(settings["metadata.jmcomic.enabled"], false);
    assert_eq!(settings["metadata.jmcomic.auto_enrich"], "off");
    assert!(db.health().unwrap().ok);
}

#[test]
fn resetting_settings_disables_online_jmcomic_metadata_without_removing_links() {
    let dir = tempfile::tempdir().unwrap();
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    db.seed_defaults().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    let book_id = db
        .upsert_scanned_book(&scanned_book(library.id, "Work", &work))
        .unwrap();
    db.import_external_identities(
        "jmcomic",
        &[ExternalIdentityCandidate {
            book_id,
            remote_id: "13579".to_string(),
            canonical_source_path: work.to_string_lossy().to_string(),
        }],
    )
    .unwrap();
    db.set_setting(
        "metadata.jmcomic.enabled".to_string(),
        serde_json::Value::Bool(true),
    )
    .unwrap();

    let settings = db.reset_settings().unwrap();

    assert_eq!(settings["metadata.jmcomic.enabled"], false);
    assert!(db
        .external_identity_for_book(book_id, "jmcomic")
        .unwrap()
        .is_some());
}

#[test]
fn imports_external_identities_idempotently_and_rejects_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let first_path = dir.path().join("first");
    let second_path = dir.path().join("second");
    std::fs::create_dir_all(&first_path).unwrap();
    std::fs::create_dir_all(&second_path).unwrap();
    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    let first = db
        .upsert_scanned_book(&scanned_book(library.id, "First", &first_path))
        .unwrap();
    let second = db
        .upsert_scanned_book(&scanned_book(library.id, "Second", &second_path))
        .unwrap();
    let candidate = ExternalIdentityCandidate {
        book_id: first,
        remote_id: "12345".to_string(),
        canonical_source_path: first_path.to_string_lossy().to_string(),
    };

    let imported = db
        .import_external_identities("jmcomic", std::slice::from_ref(&candidate))
        .unwrap();
    assert_eq!(imported.linked, 1);
    let repeated = db
        .import_external_identities("jmcomic", std::slice::from_ref(&candidate))
        .unwrap();
    assert_eq!(repeated.unchanged, 1);
    let conflict = db
        .import_external_identities(
            "jmcomic",
            &[ExternalIdentityCandidate {
                book_id: second,
                remote_id: "12345".to_string(),
                canonical_source_path: second_path.to_string_lossy().to_string(),
            }],
        )
        .unwrap();
    assert_eq!(conflict.conflicts, 1);
    assert_eq!(
        db.external_identity_for_book(first, "jmcomic")
            .unwrap()
            .unwrap()
            .remote_id,
        "12345"
    );
    assert!(db
        .external_identity_for_book(second, "jmcomic")
        .unwrap()
        .is_none());
}

#[test]
fn caches_source_metadata_without_overwriting_manual_fields_or_tags() {
    let dir = tempfile::tempdir().unwrap();
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    let book_id = db
        .upsert_scanned_book(&scanned_book(library.id, "Scanned title", &work))
        .unwrap();
    db.update_book_metadata(
        book_id,
        MetadataUpdate {
            title: "My title".to_string(),
            author: None,
            volume: None,
            chapter: None,
        },
    )
    .unwrap();
    db.set_book_tags(book_id, vec!["My tag".to_string()])
        .unwrap();
    db.import_external_identities(
        "jmcomic",
        &[ExternalIdentityCandidate {
            book_id,
            remote_id: "67890".to_string(),
            canonical_source_path: work.to_string_lossy().to_string(),
        }],
    )
    .unwrap();
    db.store_external_metadata(
        &ExternalBookMetadata {
            book_id,
            provider_id: "jmcomic".to_string(),
            remote_id: "67890".to_string(),
            original_title: Some("Provider title".to_string()),
            authors: vec!["Provider author".to_string()],
            categories: vec!["Category".to_string(), " category ".to_string()],
            tags: vec![
                "Tag A".to_string(),
                " tag a ".to_string(),
                "Tag B".to_string(),
            ],
            description: Some("Description".to_string()),
            chapters: vec![ExternalChapterMetadata {
                remote_id: "67891".to_string(),
                name: Some("Episode".to_string()),
                sort: Some(1),
            }],
            remote_cover_url: None,
            fetched_at: "2026-08-13T00:00:00Z".to_string(),
            expires_at: "2026-09-12T00:00:00Z".to_string(),
            status: "fresh".to_string(),
            error_message: None,
        },
        "payload-hash",
    )
    .unwrap();

    let cached = db
        .external_metadata_for_book(book_id, "jmcomic")
        .unwrap()
        .unwrap();
    assert_eq!(cached.tags, vec!["Tag A", "Tag B"]);
    assert_eq!(cached.categories, vec!["Category"]);
    assert_eq!(db.list_categories().unwrap(), vec!["Category"]);
    assert!(db.list_tags().unwrap().contains(&"Tag A".to_string()));
    let merge = db
        .metadata_merge_preview(book_id, "jmcomic")
        .unwrap()
        .unwrap();
    assert!(
        merge
            .fields
            .iter()
            .find(|field| field.field_name == "title")
            .unwrap()
            .manually_edited
    );
    assert!(
        merge
            .fields
            .iter()
            .find(|field| field.field_name == "author")
            .unwrap()
            .default_selected
    );
    assert_eq!(db.get_book(book_id).unwrap().tags, vec!["My tag"]);
    assert_eq!(
        db.jmcomic_book_source(book_id)
            .unwrap()
            .unwrap()
            .identity
            .remote_id,
        "67890"
    );

    for query in [
        BookQuery {
            search: None,
            sort: None,
            view: None,
            favorite: None,
            author: None,
            tag: Some("Tag A".to_string()),
            category: None,
            format: None,
            status: None,
            min_rating: None,
            duplicates_only: None,
            limit: None,
            offset: None,
        },
        BookQuery {
            search: None,
            sort: None,
            view: None,
            favorite: None,
            author: None,
            tag: None,
            category: Some("Category".to_string()),
            format: None,
            status: None,
            min_rating: None,
            duplicates_only: None,
            limit: None,
            offset: None,
        },
        BookQuery {
            search: Some("67890".to_string()),
            sort: None,
            view: None,
            favorite: None,
            author: None,
            tag: None,
            category: None,
            format: None,
            status: None,
            min_rating: None,
            duplicates_only: None,
            limit: None,
            offset: None,
        },
        BookQuery {
            search: Some("Provider title".to_string()),
            sort: None,
            view: None,
            favorite: None,
            author: None,
            tag: None,
            category: None,
            format: None,
            status: None,
            min_rating: None,
            duplicates_only: None,
            limit: None,
            offset: None,
        },
    ] {
        assert_eq!(db.list_books(query).unwrap().len(), 1);
    }
}

#[test]
fn records_metadata_job_lifecycle_and_provider_counts() {
    let dir = tempfile::tempdir().unwrap();
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    let book_id = db
        .upsert_scanned_book(&scanned_book(library.id, "Work", &work))
        .unwrap();
    db.import_external_identities(
        "jmcomic",
        &[ExternalIdentityCandidate {
            book_id,
            remote_id: "24680".to_string(),
            canonical_source_path: work.to_string_lossy().to_string(),
        }],
    )
    .unwrap();

    let job = db
        .create_metadata_job("jmcomic", book_id, "24680", "user")
        .unwrap();
    assert_eq!(job.status, "queued");
    assert_eq!(
        db.metadata_provider_counts("jmcomic").unwrap(),
        (1, 0, 1, 0)
    );
    let running = db.update_metadata_job(job.id, "running", None).unwrap();
    assert_eq!(running.status, "running");
    assert_eq!(running.attempts, 1);
    assert_eq!(
        db.metadata_provider_counts("jmcomic").unwrap(),
        (1, 0, 0, 1)
    );
    let failed = db
        .update_metadata_job(job.id, "failed", Some("network unavailable"))
        .unwrap();
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.error_message.as_deref(), Some("network unavailable"));
    assert_eq!(
        db.recent_metadata_jobs("jmcomic", 10).unwrap(),
        vec![failed]
    );
}

#[test]
fn searches_chinese_substrings_and_escapes_like_wildcards() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    db.upsert_scanned_book(&ScannedBook {
        library_id: library.id,
        title: "夏日奇幻_100%".to_string(),
        sort_title: "夏日奇幻_100%".to_string(),
        author: Some("张三".to_string()),
        volume: None,
        chapter: None,
        path: dir
            .path()
            .join("夏日奇幻_100%")
            .to_string_lossy()
            .to_string(),
        format: "folder".to_string(),
        file_size: 0,
        modified_at: None,
        page_count: 0,
        checksum: None,
        pages: Vec::new(),
    })
    .unwrap();

    for search in ["奇幻", "张三", "100%", "幻_100"] {
        let books = db
            .list_books(BookQuery {
                search: Some(search.to_string()),
                sort: None,
                view: None,
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: None,
                min_rating: None,
                duplicates_only: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(books.len(), 1, "search should match {search}");
    }
}

#[test]
fn finds_available_book_by_canonical_path() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    let path = dir.path().join("direct-open.cbz");
    std::fs::write(&path, b"fixture").unwrap();
    let id = db
        .upsert_scanned_book(&ScannedBook {
            library_id: library.id,
            title: "Direct Open".to_string(),
            sort_title: "direct open".to_string(),
            author: None,
            volume: None,
            chapter: None,
            path: path.canonicalize().unwrap().to_string_lossy().to_string(),
            format: "cbz".to_string(),
            file_size: 7,
            modified_at: None,
            page_count: 1,
            checksum: None,
            pages: Vec::new(),
        })
        .unwrap();

    let book = db
        .get_book_by_path(&path.canonicalize().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(book.id, id);
}

#[test]
fn marks_stale_scan_jobs_interrupted_and_keeps_them_retryable() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    let job_id = db.create_scan_job(Some(library.id), dir.path()).unwrap();
    db.update_scan_job(job_id, "running", 2, 1, 0, Some("working"))
        .unwrap();

    assert_eq!(db.mark_interrupted_scan_jobs().unwrap(), 1);
    let job = db
        .list_scan_jobs()
        .unwrap()
        .into_iter()
        .find(|job| job.id == job_id)
        .unwrap();
    assert_eq!(job.status, "interrupted");
    assert!(job.finished_at.is_some());

    let (root, recursive) = db.retry_scan_target(job_id).unwrap();
    assert_eq!(root, dir.path());
    assert!(recursive);
}

#[test]
fn purges_deleted_book_relations_without_touching_available_books() {
    let dir = tempfile::tempdir().unwrap();
    let active_path = dir.path().join("active-book");
    std::fs::create_dir_all(&active_path).unwrap();
    let deleted_path = dir.path().join("deleted-book");
    let thumbnail_root = dir.path().join("thumbnails");
    std::fs::create_dir_all(&thumbnail_root).unwrap();
    let thumbnail_path = thumbnail_root.join("deleted.jpg");
    std::fs::write(&thumbnail_path, b"cache").unwrap();

    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    let library = db.upsert_library(dir.path(), true).unwrap();
    let active_id = db
        .upsert_scanned_book(&scanned_book(library.id, "Active", &active_path))
        .unwrap();
    let deleted_id = db
        .upsert_scanned_book(&scanned_book(library.id, "Deleted", &deleted_path))
        .unwrap();
    db.upsert_thumbnail(ThumbnailRecord {
        book_id: deleted_id,
        page_index: 0,
        cache_key: "deleted-thumbnail",
        disk_path: &thumbnail_path,
        width: 10,
        height: 10,
        byte_size: 5,
    })
    .unwrap();

    assert_eq!(db.mark_missing_books(library.id).unwrap(), 1);
    assert_eq!(db.purge_missing_books(Some(library.id)).unwrap(), 1);
    let preview = db.deleted_book_cleanup_preview().unwrap();
    assert_eq!(preview.books, 1);
    assert_eq!(preview.pages, 1);
    assert_eq!(preview.chapters, 1);
    assert_eq!(preview.thumbnails, 1);
    assert_eq!(preview.thumbnail_bytes, 5);
    assert_eq!(
        db.deleted_book_thumbnail_paths().unwrap(),
        vec![thumbnail_path.clone()]
    );

    let result = db.purge_deleted_books().unwrap();
    assert_eq!(result.books_removed, 1);
    assert_eq!(result.pages_removed, 1);
    assert_eq!(result.chapters_removed, 1);
    assert_eq!(result.thumbnail_records_removed, 1);
    assert!(db.get_book(deleted_id).is_err());
    assert_eq!(db.get_book(active_id).unwrap().status, "available");
    assert_eq!(db.deleted_book_cleanup_preview().unwrap().books, 0);
    assert!(
        thumbnail_path.exists(),
        "database cleanup must not remove source cache files"
    );
}

fn scanned_book(library_id: i64, title: &str, path: &std::path::Path) -> ScannedBook {
    ScannedBook {
        library_id,
        title: title.to_string(),
        sort_title: title.to_lowercase(),
        author: None,
        volume: None,
        chapter: None,
        path: path.to_string_lossy().to_string(),
        format: "folder".to_string(),
        file_size: 1,
        modified_at: None,
        page_count: 1,
        checksum: Some(title.to_string()),
        pages: vec![ScannedPage {
            page_index: 0,
            source_path: "001.jpg".to_string(),
            width: Some(10),
            height: Some(10),
            byte_size: Some(1),
        }],
    }
}
