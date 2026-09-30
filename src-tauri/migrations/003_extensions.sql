CREATE TABLE IF NOT EXISTS plugin_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_manifest_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(plugin_manifest_id) REFERENCES plugin_manifests(id) ON DELETE CASCADE,
  UNIQUE(plugin_manifest_id, key)
);

CREATE TABLE IF NOT EXISTS metadata_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  source_id INTEGER,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE SET NULL,
  FOREIGN KEY(source_id) REFERENCES metadata_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS smart_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  query_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT,
  task_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(provider_id) REFERENCES ai_providers(provider_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS upscale_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  model_path TEXT,
  scale INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_id, name)
);

CREATE TABLE IF NOT EXISTS upscale_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT,
  book_id INTEGER,
  page_index INTEGER,
  input_path TEXT NOT NULL,
  output_path TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  scale INTEGER NOT NULL DEFAULT 2,
  options_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE SET NULL,
  FOREIGN KEY(provider_id) REFERENCES ai_providers(provider_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS upscale_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  page_index INTEGER,
  cache_key TEXT NOT NULL UNIQUE,
  source_path TEXT NOT NULL,
  output_path TEXT NOT NULL,
  provider_id TEXT,
  model_id INTEGER,
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(model_id) REFERENCES upscale_models(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS image_enhance_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reader_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  direction TEXT NOT NULL,
  fit TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_reader_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL UNIQUE,
  profile_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id) REFERENCES reader_profiles(profile_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS series_reader_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL UNIQUE,
  profile_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(series_id) REFERENCES series(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id) REFERENCES reader_profiles(profile_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ocr_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  page_index INTEGER NOT NULL,
  provider_id TEXT,
  text_regions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS translation_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  page_index INTEGER NOT NULL,
  source_locale TEXT NOT NULL,
  target_locale TEXT NOT NULL,
  provider_id TEXT,
  overlay_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feature_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS license_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT,
  status TEXT NOT NULL DEFAULT 'community',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  value TEXT NOT NULL DEFAULT 'false',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  target TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_path TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugin_manifests_enabled ON plugin_manifests(enabled);
CREATE INDEX IF NOT EXISTS idx_metadata_history_book ON metadata_history(book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_provider_status ON sync_log(provider_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_priority ON ai_tasks(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_upscale_jobs_status_priority ON upscale_jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_upscale_cache_book_page ON upscale_cache(book_id, page_index);
CREATE INDEX IF NOT EXISTS idx_reader_profiles_mode ON reader_profiles(mode, direction);
CREATE INDEX IF NOT EXISTS idx_book_reader_settings_profile ON book_reader_settings(profile_id);
CREATE INDEX IF NOT EXISTS idx_series_reader_settings_profile ON series_reader_settings(profile_id);
CREATE INDEX IF NOT EXISTS idx_ocr_cache_book_page ON ocr_cache(book_id, page_index);
CREATE INDEX IF NOT EXISTS idx_translation_cache_book_page ON translation_cache(book_id, page_index);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(enabled);
CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created_at ON backup_snapshots(created_at DESC);
