INSERT OR IGNORE INTO metadata_sources(
  provider_id, name, enabled, priority, config_json, created_at, updated_at
) VALUES (
  'jmcomic', 'JMComic', 0, 100,
  '{"endpoint":"https://www.cdngwc.cc","refreshDays":30,"requestIntervalMs":1200}',
  datetime('now'), datetime('now')
);

CREATE TABLE IF NOT EXISTS external_book_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  match_method TEXT NOT NULL,
  match_confidence REAL NOT NULL DEFAULT 1.0 CHECK(match_confidence >= 0 AND match_confidence <= 1),
  canonical_source_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id) REFERENCES metadata_sources(provider_id) ON DELETE CASCADE,
  UNIQUE(provider_id, remote_id),
  UNIQUE(book_id, provider_id)
);

CREATE TABLE IF NOT EXISTS external_book_metadata (
  book_id INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  original_title TEXT,
  authors_json TEXT NOT NULL DEFAULT '[]',
  categories_json TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  chapters_json TEXT NOT NULL DEFAULT '[]',
  remote_cover_url TEXT,
  payload_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'fresh',
  error_message TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(book_id, provider_id),
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id) REFERENCES metadata_sources(provider_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_book_tags (
  book_id INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  normalized_tag TEXT NOT NULL,
  source_tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(book_id, provider_id, normalized_tag),
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id) REFERENCES metadata_sources(provider_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS metadata_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  remote_id TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id) REFERENCES metadata_sources(provider_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_external_book_ids_remote
  ON external_book_ids(provider_id, remote_id);
CREATE INDEX IF NOT EXISTS idx_external_book_metadata_expiry
  ON external_book_metadata(provider_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_external_book_tags_tag
  ON external_book_tags(provider_id, normalized_tag, book_id);
CREATE INDEX IF NOT EXISTS idx_metadata_jobs_status
  ON metadata_jobs(provider_id, status, created_at);

INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
  ('metadata.jmcomic.enabled', 'false', datetime('now')),
  ('metadata.jmcomic.endpoint', '"https://www.cdngwc.cc"', datetime('now')),
  ('metadata.jmcomic.refresh_days', '30', datetime('now')),
  ('metadata.jmcomic.request_interval_ms', '1200', datetime('now')),
  ('metadata.jmcomic.auto_enrich', '"off"', datetime('now'));
