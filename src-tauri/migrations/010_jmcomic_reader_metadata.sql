CREATE TABLE IF NOT EXISTS external_book_categories (
  book_id INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  normalized_category TEXT NOT NULL,
  source_category TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(book_id, provider_id, normalized_category),
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id) REFERENCES metadata_sources(provider_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_external_book_categories_category
  ON external_book_categories(provider_id, normalized_category, book_id);

INSERT OR IGNORE INTO external_book_categories(
  book_id, provider_id, normalized_category, source_category, created_at, updated_at
)
SELECT
  metadata.book_id,
  metadata.provider_id,
  lower(trim(category.value)),
  trim(category.value),
  metadata.fetched_at,
  metadata.updated_at
FROM external_book_metadata metadata,
     json_each(metadata.categories_json) category
WHERE category.type = 'text' AND trim(category.value) <> '';

INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
  ('metadata.jmcomic.database_path', 'null', datetime('now')),
  ('metadata.jmcomic.auto_link', 'false', datetime('now'));
