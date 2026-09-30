use std::fs;
use std::io::Write;

use mangavault_desktop::db::Database;
use mangavault_desktop::models::BookQuery;
use mangavault_desktop::scanner::{discover, scan_candidate};
use zip::write::SimpleFileOptions;

const PNG_1X1: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3,
    253, 167, 89, 231, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

#[test]
fn imports_scans_searches_progress_and_bookmarks() {
    let dir = tempfile::tempdir().unwrap();
    let library_dir = dir.path().join("library");
    let book_dir = library_dir.join("[Ada] Signal Garden Vol. 1 Ch. 2");
    fs::create_dir_all(&book_dir).unwrap();
    fs::write(book_dir.join("001.png"), PNG_1X1).unwrap();
    fs::write(book_dir.join("002.png"), PNG_1X1).unwrap();

    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    db.seed_defaults().unwrap();
    let library = db.upsert_library(&library_dir, true).unwrap();
    let scanned = scan_candidate(library.id, &book_dir).unwrap();
    let book_id = db.upsert_scanned_book(&scanned).unwrap();

    let books = db
        .list_books(BookQuery {
            search: Some("Signal".to_string()),
            sort: Some("title".to_string()),
            view: None,
            favorite: None,
            author: None,
            tag: None,
            category: None,
            format: Some("folder".to_string()),
            status: Some("available".to_string()),
            min_rating: None,
            duplicates_only: None,
            limit: Some(20),
            offset: Some(0),
        })
        .unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].page_count, 2);
    assert_eq!(books[0].author.as_deref(), Some("Ada"));
    assert_eq!(books[0].title, "[Ada] Signal Garden Vol. 1 Ch. 2");
    assert_eq!(books[0].volume, Some(1.0));
    assert_eq!(books[0].chapter, Some(2.0));
    let chapters = db.chapters_for_book(book_id).unwrap();
    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].start_page, 0);
    assert_eq!(chapters[0].page_count, 2);

    db.record_reading_opened(book_id, 0).unwrap();
    let progress = db
        .save_progress(book_id, 1, 2, "single".to_string(), "ltr".to_string())
        .unwrap();
    assert_eq!(progress.current_page, 1);
    assert!(progress.percent > 0.9);

    let bookmark = db
        .add_bookmark(book_id, 1, Some("Last page".to_string()))
        .unwrap();
    let bookmarks = db.list_bookmarks(book_id).unwrap();
    assert_eq!(bookmarks.len(), 1);
    assert_eq!(bookmarks[0].id, bookmark.id);

    let history = db.list_history().unwrap();
    assert_eq!(history[0].book_id, book_id);
    assert_eq!(history[0].title, "[Ada] Signal Garden Vol. 1 Ch. 2");
    assert_eq!(history[0].page_index, 1);
    assert_eq!(history[0].total_pages, 2);

    db.record_reading_opened(book_id, 1).unwrap();
    db.save_progress(book_id, 0, 2, "single".to_string(), "ltr".to_string())
        .unwrap();
    let history = db.list_history().unwrap();
    assert_eq!(
        history.len(),
        1,
        "history should show one latest entry per book"
    );
    assert_eq!(history[0].page_index, 0);

    let health = db.health().unwrap();
    assert!(health.ok);
    assert_eq!(health.message, "ok");

    let backup_path = db.create_backup().unwrap();
    assert!(backup_path.exists());

    fs::remove_dir_all(&book_dir).unwrap();
    let missing = db.mark_missing_books(library.id).unwrap();
    assert_eq!(missing, 1);
    let missing_books = db
        .list_books(BookQuery {
            search: Some("Signal".to_string()),
            sort: Some("title".to_string()),
            view: None,
            favorite: None,
            author: None,
            tag: None,
            category: None,
            format: None,
            status: Some("missing".to_string()),
            min_rating: None,
            duplicates_only: None,
            limit: Some(20),
            offset: Some(0),
        })
        .unwrap();
    assert_eq!(missing_books.len(), 1);
    let removed = db.purge_missing_books(Some(library.id)).unwrap();
    assert_eq!(removed, 1);
    let visible_books = db
        .list_books(BookQuery {
            search: Some("Signal".to_string()),
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
            limit: Some(20),
            offset: Some(0),
        })
        .unwrap();
    assert!(visible_books.is_empty());
}

#[test]
fn imports_single_archive_file_candidate() {
    let dir = tempfile::tempdir().unwrap();
    let library_dir = dir.path().join("library");
    fs::create_dir_all(&library_dir).unwrap();
    let cbz_path = library_dir.join("[Ada] Quiet Signal Vol. 1.cbz");
    write_cbz(&cbz_path);

    let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
    db.migrate().unwrap();
    db.seed_defaults().unwrap();
    let library = db.upsert_library(&library_dir, true).unwrap();

    let cancel = std::sync::atomic::AtomicBool::new(false);
    let candidates = discover(&cbz_path, false, &cancel);
    assert_eq!(candidates, vec![cbz_path.clone()]);

    let scanned = scan_candidate(library.id, &cbz_path).unwrap();
    let book_id = db.upsert_scanned_book(&scanned).unwrap();
    let book = db.get_book(book_id).unwrap();
    assert_eq!(book.format, "cbz");
    assert_eq!(book.page_count, 1);
    assert_eq!(book.author.as_deref(), Some("Ada"));
    assert_eq!(book.title, "[Ada] Quiet Signal Vol. 1");
}

fn write_cbz(path: &std::path::Path) {
    let file = fs::File::create(path).unwrap();
    let mut archive = zip::ZipWriter::new(file);
    archive
        .start_file("001.png", SimpleFileOptions::default())
        .unwrap();
    archive.write_all(PNG_1X1).unwrap();
    archive.finish().unwrap();
}
