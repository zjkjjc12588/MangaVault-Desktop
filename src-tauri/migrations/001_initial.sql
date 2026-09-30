PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  recursive INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_scan_at TEXT
);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  sort_title TEXT NOT NULL,
  author TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER,
  series_id INTEGER,
  title TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  author TEXT,
  volume REAL,
  chapter REAL,
  path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  cover_page_index INTEGER NOT NULL DEFAULT 0,
  cover_cache_key TEXT,
  checksum TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  status TEXT NOT NULL DEFAULT 'available',
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_read_at TEXT,
  FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE SET NULL,
  FOREIGN KEY(series_id) REFERENCES series(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  chapter_number REAL,
  start_page INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  page_index INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(book_id, page_index),
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_tags (
  book_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(book_id, tag_id),
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reading_progress (
  book_id INTEGER PRIMARY KEY,
  current_page INTEGER NOT NULL DEFAULT 0,
  total_pages INTEGER NOT NULL DEFAULT 0,
  percent REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'single',
  direction TEXT NOT NULL DEFAULT 'ltr',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  page_index INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(book_id, page_index),
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  page_index INTEGER NOT NULL,
  opened_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS thumbnails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  page_index INTEGER NOT NULL,
  cache_key TEXT NOT NULL UNIQUE,
  disk_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER,
  root_path TEXT NOT NULL,
  status TEXT NOT NULL,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_books_title ON books(sort_title);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_recent ON books(last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_imported ON books(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_rating ON books(rating DESC);
CREATE INDEX IF NOT EXISTS idx_books_favorite ON books(is_favorite);
CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id, chapter, volume);
CREATE INDEX IF NOT EXISTS idx_pages_book_index ON pages(book_id, page_index);
CREATE INDEX IF NOT EXISTS idx_history_book_opened ON reading_history(book_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status, started_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  title,
  author,
  path,
  content='books',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
  INSERT INTO books_fts(rowid, title, author, path) VALUES (new.id, new.title, coalesce(new.author, ''), new.path);
END;

CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, author, path) VALUES('delete', old.id, old.title, coalesce(old.author, ''), old.path);
END;

CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, author, path) VALUES('delete', old.id, old.title, coalesce(old.author, ''), old.path);
  INSERT INTO books_fts(rowid, title, author, path) VALUES (new.id, new.title, coalesce(new.author, ''), new.path);
END;
