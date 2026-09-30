CREATE TABLE IF NOT EXISTS scan_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_job_id INTEGER NOT NULL,
  path TEXT,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(scan_job_id) REFERENCES scan_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scan_failures_job_id
  ON scan_failures(scan_job_id, id ASC);
