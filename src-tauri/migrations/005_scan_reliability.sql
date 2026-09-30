CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
  ('scanner.max_total_extract_bytes', '536870912', datetime('now')),
  ('scanner.max_archive_entries', '10000', datetime('now')),
  ('scanner.max_compression_ratio', '200', datetime('now')),
  ('scanner.max_image_pixels', '100000000', datetime('now')),
  ('scanner.command_timeout_seconds', '30', datetime('now')),
  ('scanner.max_command_output_bytes', '8388608', datetime('now'));

CREATE INDEX IF NOT EXISTS idx_scan_jobs_active
  ON scan_jobs(status, started_at DESC)
  WHERE status IN ('queued', 'running', 'cancelling');
