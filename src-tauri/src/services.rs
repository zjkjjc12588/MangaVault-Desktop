use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use crate::db::Database;
use crate::error::Result;
use crate::scanner::{discover_with_progress_with_cancel, scan_candidate_with_limits, ScanStats};

const MAX_FAILURE_MESSAGES: usize = 100;

#[derive(Debug, Clone, Copy)]
pub struct ScanOptions {
    pub recursive: bool,
    pub mark_missing: bool,
}

pub fn run_scan_roots_job(
    db: &mut Database,
    library_id: i64,
    job_id: i64,
    roots: Vec<PathBuf>,
    options: ScanOptions,
    cancel: &AtomicBool,
    is_cancelled: impl Fn(i64) -> bool,
) -> Result<(i64, ScanStats)> {
    let mut stats = ScanStats::default();
    let mut candidates = Vec::new();
    let mut discovery_had_failures = false;
    let mut persisted_failures = 0;
    let limits = db.archive_limits()?;
    let mut last_discovery_write = Instant::now();
    for root in roots {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) || is_cancelled(job_id) {
            db.update_scan_job(
                job_id,
                "cancelled",
                stats.discovered,
                stats.imported,
                stats.failed,
                Some("cancelled by user"),
            )?;
            return Ok((job_id, stats));
        }
        let base_count = candidates.len();
        let discovery = discover_with_progress_with_cancel(
            &root,
            options.recursive,
            &|| cancel.load(std::sync::atomic::Ordering::Relaxed) || is_cancelled(job_id),
            |count| {
                let discovered = (base_count + count) as i64;
                if should_write_scan_progress(discovered, last_discovery_write.elapsed()) {
                    let _ = db.update_scan_job(
                        job_id,
                        "running",
                        discovered,
                        0,
                        0,
                        Some("discovering"),
                    );
                    last_discovery_write = Instant::now();
                }
            },
        );
        if discovery.cancelled {
            db.update_scan_job(
                job_id,
                "cancelled",
                stats.discovered,
                stats.imported,
                stats.failed,
                Some("cancelled by user"),
            )?;
            return Ok((job_id, stats));
        }
        if !discovery.failures.is_empty() {
            discovery_had_failures = true;
            for failure in discovery.failures {
                stats.failed += 1;
                if persisted_failures < MAX_FAILURE_MESSAGES {
                    db.record_scan_failure(job_id, None, "discovery", &failure)?;
                    persisted_failures += 1;
                }
                retain_failure_message(&mut stats, failure);
            }
        }
        candidates.extend(discovery.candidates);
    }
    candidates.sort();
    candidates.dedup();
    stats.discovered = candidates.len() as i64;
    let discovered_paths = candidates
        .iter()
        .map(|candidate| candidate.to_string_lossy().to_string())
        .collect::<HashSet<_>>();
    db.update_scan_job(
        job_id,
        "running",
        stats.discovered,
        stats.imported,
        stats.failed,
        stats.failures.last().map(String::as_str),
    )?;
    let mut last_progress_write = Instant::now();
    for candidate in candidates {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) || is_cancelled(job_id) {
            db.update_scan_job(
                job_id,
                "cancelled",
                stats.discovered,
                stats.imported,
                stats.failed,
                Some("cancelled by user"),
            )?;
            return Ok((job_id, stats));
        }
        match scan_candidate_with_limits(library_id, &candidate, limits) {
            Ok(book) => {
                if let Err(err) = db.upsert_scanned_book(&book) {
                    stats.failed += 1;
                    let failure = format!("{}: {err}", candidate.to_string_lossy());
                    if persisted_failures < MAX_FAILURE_MESSAGES {
                        db.record_scan_failure(
                            job_id,
                            Some(&candidate),
                            "database",
                            &err.to_string(),
                        )?;
                        persisted_failures += 1;
                    }
                    retain_failure_message(&mut stats, failure);
                } else {
                    stats.imported += 1;
                }
            }
            Err(err) => {
                stats.failed += 1;
                let failure = format!("{}: {err}", candidate.to_string_lossy());
                if persisted_failures < MAX_FAILURE_MESSAGES {
                    db.record_scan_failure(job_id, Some(&candidate), "index", &err.to_string())?;
                    persisted_failures += 1;
                }
                retain_failure_message(&mut stats, failure);
            }
        }
        let processed = stats.imported + stats.failed;
        if should_write_scan_progress(processed, last_progress_write.elapsed()) {
            db.update_scan_job(
                job_id,
                "running",
                stats.discovered,
                stats.imported,
                stats.failed,
                stats.failures.last().map(String::as_str),
            )?;
            last_progress_write = Instant::now();
        }
    }
    let missing = if options.mark_missing && !discovery_had_failures {
        db.mark_missing_books_not_in(library_id, &discovered_paths)?
    } else {
        0
    };
    db.mark_library_scanned(library_id)?;
    let message = if discovery_had_failures {
        Some("scan discovery had access errors; missing entries were not changed".to_string())
    } else if missing > 0 {
        Some(format!("{missing} missing files marked unavailable"))
    } else {
        stats.failures.last().cloned()
    };
    db.update_scan_job(
        job_id,
        "complete",
        stats.discovered,
        stats.imported,
        stats.failed,
        message.as_deref(),
    )?;
    Ok((job_id, stats))
}

fn retain_failure_message(stats: &mut ScanStats, message: String) {
    if stats.failures.len() < MAX_FAILURE_MESSAGES {
        stats.failures.push(message);
    }
}

fn should_write_scan_progress(processed: i64, elapsed: Duration) -> bool {
    processed <= 5 || processed % 10 == 0 || elapsed >= Duration::from_millis(750)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_progress_updates_are_throttled_for_large_batches() {
        assert!(should_write_scan_progress(1, Duration::ZERO));
        assert!(should_write_scan_progress(5, Duration::ZERO));
        assert!(!should_write_scan_progress(6, Duration::from_millis(50)));
        assert!(should_write_scan_progress(10, Duration::from_millis(50)));
        assert!(should_write_scan_progress(11, Duration::from_millis(800)));
    }

    #[test]
    fn records_candidate_failures_without_aborting_the_scan_job() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        std::fs::create_dir_all(&root).unwrap();
        let broken_archive = root.join("broken.cbz");
        std::fs::write(&broken_archive, b"not a zip archive").unwrap();
        let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&root, true).unwrap();
        let job_id = db.create_scan_job(Some(library.id), &root).unwrap();
        let cancel = AtomicBool::new(false);

        let (_, stats) = run_scan_roots_job(
            &mut db,
            library.id,
            job_id,
            vec![root],
            ScanOptions {
                recursive: true,
                mark_missing: false,
            },
            &cancel,
            |_| false,
        )
        .unwrap();

        assert_eq!(stats.failed, 1);
        let failures = db.list_scan_failures(job_id).unwrap();
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].stage, "index");
        assert_eq!(
            failures[0].path.as_deref(),
            Some(broken_archive.to_string_lossy().as_ref())
        );
        assert!(db
            .list_scan_jobs()
            .unwrap()
            .into_iter()
            .any(|job| job.id == job_id && job.status == "complete" && job.failed_count == 1));
    }

    #[test]
    fn rescanning_an_empty_image_folder_marks_the_book_missing_and_keeps_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let book_dir = root.join("Sample Book");
        std::fs::create_dir_all(&book_dir).unwrap();
        let page = book_dir.join("001.webp");
        std::fs::write(&page, b"page-data").unwrap();
        let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&root, true).unwrap();
        let cancel = AtomicBool::new(false);
        let initial_job = db.create_scan_job(Some(library.id), &root).unwrap();

        run_scan_roots_job(
            &mut db,
            library.id,
            initial_job,
            vec![root.clone()],
            ScanOptions {
                recursive: true,
                mark_missing: true,
            },
            &cancel,
            |_| false,
        )
        .unwrap();
        let book_id = db.get_book(1).unwrap().id;
        db.toggle_favorite(book_id).unwrap();
        db.set_book_tags(book_id, vec!["keep-me".to_string()])
            .unwrap();
        std::fs::remove_file(page).unwrap();
        let rescan_job = db.create_scan_job(Some(library.id), &root).unwrap();

        let (_, stats) = run_scan_roots_job(
            &mut db,
            library.id,
            rescan_job,
            vec![root],
            ScanOptions {
                recursive: true,
                mark_missing: true,
            },
            &cancel,
            |_| false,
        )
        .unwrap();

        assert_eq!(stats.discovered, 0);
        let missing = db.get_book(book_id).unwrap();
        assert_eq!(missing.status, "missing");
        assert!(missing.is_favorite);
        assert_eq!(missing.tags, vec!["keep-me"]);
    }

    #[test]
    fn rescanning_a_moved_image_folder_marks_the_previous_book_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("library");
        let book_dir = root.join("Original Location");
        std::fs::create_dir_all(&book_dir).unwrap();
        std::fs::write(book_dir.join("001.webp"), b"page-data").unwrap();
        let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
        db.migrate().unwrap();
        let library = db.upsert_library(&root, true).unwrap();
        let cancel = AtomicBool::new(false);
        let initial_job = db.create_scan_job(Some(library.id), &root).unwrap();

        run_scan_roots_job(
            &mut db,
            library.id,
            initial_job,
            vec![root.clone()],
            ScanOptions {
                recursive: true,
                mark_missing: true,
            },
            &cancel,
            |_| false,
        )
        .unwrap();
        let original_book_id = db.get_book(1).unwrap().id;
        db.set_book_tags(original_book_id, vec!["original-metadata".to_string()])
            .unwrap();
        std::fs::rename(&book_dir, root.join("Moved Location")).unwrap();
        let rescan_job = db.create_scan_job(Some(library.id), &root).unwrap();

        let (_, stats) = run_scan_roots_job(
            &mut db,
            library.id,
            rescan_job,
            vec![root],
            ScanOptions {
                recursive: true,
                mark_missing: true,
            },
            &cancel,
            |_| false,
        )
        .unwrap();

        assert_eq!(stats.discovered, 1);
        let original = db.get_book(original_book_id).unwrap();
        assert_eq!(original.status, "missing");
        assert_eq!(original.tags, vec!["original-metadata"]);
    }

    #[test]
    #[ignore = "set MANGAVAULT_SCAN_BENCHMARK_ROOT to run against a real local library"]
    fn benchmarks_real_library_import_into_an_isolated_database() {
        let root = std::env::var_os("MANGAVAULT_SCAN_BENCHMARK_ROOT")
            .map(PathBuf::from)
            .expect("MANGAVAULT_SCAN_BENCHMARK_ROOT must be set");
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("mangavault.sqlite3")).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        let library = db.upsert_library(&root, true).unwrap();
        let job_id = db.create_scan_job(Some(library.id), &root).unwrap();
        let cancel = AtomicBool::new(false);
        let started = Instant::now();

        let (_, stats) = run_scan_roots_job(
            &mut db,
            library.id,
            job_id,
            vec![root],
            ScanOptions {
                recursive: true,
                mark_missing: true,
            },
            &cancel,
            |_| false,
        )
        .unwrap();

        eprintln!(
            "real isolated import: {} imported, {} failed in {:?}",
            stats.imported,
            stats.failed,
            started.elapsed()
        );
        assert!(stats.imported > 0);
    }
}
