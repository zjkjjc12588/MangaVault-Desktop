PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_books_active_title
  ON books(sort_title COLLATE NOCASE ASC, id ASC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_author_title
  ON books(author, sort_title COLLATE NOCASE ASC, id ASC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_imported
  ON books(imported_at DESC, id DESC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_recent
  ON books(last_read_at DESC, sort_title COLLATE NOCASE ASC, id ASC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_rating
  ON books(rating DESC, sort_title COLLATE NOCASE ASC, id ASC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_favorite_title
  ON books(is_favorite, sort_title COLLATE NOCASE ASC, id ASC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_format_title
  ON books(format, sort_title COLLATE NOCASE ASC, id ASC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_status_title
  ON books(status, sort_title COLLATE NOCASE ASC, id ASC)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_books_active_checksum
  ON books(checksum, id ASC)
  WHERE checksum IS NOT NULL AND status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_reading_progress_percent
  ON reading_progress(percent DESC, book_id ASC);

CREATE INDEX IF NOT EXISTS idx_book_tags_tag_book
  ON book_tags(tag_id, book_id);

CREATE INDEX IF NOT EXISTS idx_thumbnails_book_page_key
  ON thumbnails(book_id, page_index, cache_key);
