use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{
    mpsc::{self, Sender},
    Arc, Mutex,
};

use crate::db::Database;
use crate::error::{MangaVaultError, Result};
use crate::jmcomic_metadata;
use crate::jmcomic_provider::JmComicProviderState;
use crate::services::{self, ScanOptions};

#[derive(Debug)]
pub struct ScanRequest {
    pub library_id: i64,
    pub job_id: i64,
    pub roots: Vec<PathBuf>,
    pub options: ScanOptions,
}

pub struct ScanScheduler {
    sender: Sender<ScanRequest>,
}

impl ScanScheduler {
    pub fn new(
        db_path: PathBuf,
        cancelled_jobs: Arc<Mutex<std::collections::HashSet<i64>>>,
        jmcomic_provider: Arc<JmComicProviderState>,
    ) -> Self {
        let (sender, receiver) = mpsc::channel::<ScanRequest>();
        std::thread::spawn(move || {
            while let Ok(request) = receiver.recv() {
                run_request(&db_path, &cancelled_jobs, &jmcomic_provider, request);
            }
        });
        Self { sender }
    }

    pub fn enqueue(&self, request: ScanRequest) -> Result<()> {
        self.sender
            .send(request)
            .map_err(|_| MangaVaultError::Message("scan scheduler is unavailable".to_string()))
    }
}

fn run_request(
    db_path: &PathBuf,
    cancelled_jobs: &Arc<Mutex<std::collections::HashSet<i64>>>,
    jmcomic_provider: &Arc<JmComicProviderState>,
    request: ScanRequest,
) {
    let mut db = match Database::open(db_path) {
        Ok(db) => db,
        Err(error) => {
            tauri_plugin_log::log::error!("failed to open scanner database: {error}");
            return;
        }
    };
    let is_cancelled = || {
        cancelled_jobs
            .lock()
            .map(|jobs| jobs.contains(&request.job_id))
            .unwrap_or(true)
    };
    if is_cancelled() {
        let _ = db.update_scan_job(
            request.job_id,
            "cancelled",
            0,
            0,
            0,
            Some("cancelled before scan started"),
        );
        remove_cancelled_job(cancelled_jobs, request.job_id);
        return;
    }
    let _ = db.update_scan_job(
        request.job_id,
        "running",
        0,
        0,
        0,
        Some("queued scan started"),
    );
    let cancel = AtomicBool::new(false);
    let result = services::run_scan_roots_job(
        &mut db,
        request.library_id,
        request.job_id,
        request.roots,
        request.options,
        &cancel,
        |_| is_cancelled(),
    );
    if let Err(error) = result {
        let _ = db.update_scan_job(request.job_id, "failed", 0, 0, 1, Some(&error.to_string()));
    } else {
        match jmcomic_metadata::reconcile_configured_links(&mut db) {
            Ok(candidates) => {
                let auto_enrich = jmcomic_metadata::settings(&db)
                    .map(|settings| settings.enabled && settings.auto_enrich_after_import)
                    .unwrap_or(false);
                if auto_enrich && !candidates.is_empty() {
                    let db_path = db_path.clone();
                    let provider = jmcomic_provider.clone();
                    tauri::async_runtime::spawn(async move {
                        for candidate in candidates.into_iter().take(10_000) {
                            if let Err(error) = jmcomic_metadata::refresh_book(
                                db_path.clone(),
                                provider.clone(),
                                candidate.book_id,
                                false,
                                "scan",
                            )
                            .await
                            {
                                tauri_plugin_log::log::warn!(
                                    "JMComic post-import metadata refresh failed for book {}: {}",
                                    candidate.book_id,
                                    error
                                );
                            }
                        }
                    });
                }
            }
            Err(error) => {
                tauri_plugin_log::log::warn!(
                    "JMComic post-import identity reconciliation was skipped: {error}"
                );
            }
        }
    }
    remove_cancelled_job(cancelled_jobs, request.job_id);
}

fn remove_cancelled_job(cancelled_jobs: &Arc<Mutex<std::collections::HashSet<i64>>>, job_id: i64) {
    if let Ok(mut jobs) = cancelled_jobs.lock() {
        jobs.remove(&job_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{Duration, Instant};

    use crate::models::BookQuery;

    const PNG_1X1: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
        251, 3, 253, 167, 89, 231, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    #[test]
    fn enqueue_reports_when_the_worker_is_gone() {
        let (sender, receiver) = mpsc::channel();
        drop(receiver);
        let scheduler = ScanScheduler { sender };
        let result = scheduler.enqueue(ScanRequest {
            library_id: 1,
            job_id: 1,
            roots: Vec::new(),
            options: ScanOptions {
                recursive: true,
                mark_missing: false,
            },
        });
        assert!(result.is_err());
    }

    #[test]
    fn scans_on_the_worker_while_the_caller_can_read_job_progress() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("mangavault.sqlite3");
        let library_root = dir.path().join("library");
        let book_root = library_root.join("[Ada] Signal Garden Vol. 1");
        fs::create_dir_all(&book_root).unwrap();
        fs::write(book_root.join("001.png"), PNG_1X1).unwrap();
        fs::write(book_root.join("002.png"), PNG_1X1).unwrap();

        let db = Database::open(&database_path).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        let library = db.upsert_library(&library_root, true).unwrap();
        let job_id = db.create_scan_job(Some(library.id), &library_root).unwrap();
        let cancelled_jobs = Arc::new(Mutex::new(std::collections::HashSet::new()));
        let scheduler = ScanScheduler::new(
            database_path,
            cancelled_jobs,
            Arc::new(JmComicProviderState::new().unwrap()),
        );

        scheduler
            .enqueue(ScanRequest {
                library_id: library.id,
                job_id,
                roots: vec![library_root],
                options: ScanOptions {
                    recursive: true,
                    mark_missing: true,
                },
            })
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let job = db
                .list_scan_jobs()
                .unwrap()
                .into_iter()
                .find(|job| job.id == job_id)
                .unwrap();
            if job.status == "complete" {
                assert_eq!(job.imported_count, 1);
                break;
            }
            assert_ne!(job.status, "failed");
            assert!(
                Instant::now() < deadline,
                "background scan did not finish in time"
            );
            std::thread::sleep(Duration::from_millis(10));
        }

        let books = db
            .list_books(BookQuery {
                search: None,
                sort: Some("title".to_string()),
                view: None,
                favorite: None,
                author: None,
                tag: None,
                category: None,
                format: None,
                status: Some("available".to_string()),
                min_rating: None,
                duplicates_only: None,
                limit: Some(20),
                offset: Some(0),
            })
            .unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].page_count, 2);
    }

    #[test]
    #[ignore = "set MANGAVAULT_SCAN_BENCHMARK_ROOT to run a real library through the background queue"]
    fn benchmarks_real_library_background_queue() {
        let root = std::env::var_os("MANGAVAULT_SCAN_BENCHMARK_ROOT")
            .map(PathBuf::from)
            .expect("MANGAVAULT_SCAN_BENCHMARK_ROOT must be set");
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("mangavault.sqlite3");
        let db = Database::open(&database_path).unwrap();
        db.migrate().unwrap();
        db.seed_defaults().unwrap();
        let library = db.upsert_library(&root, true).unwrap();
        let job_id = db.create_scan_job(Some(library.id), &root).unwrap();
        let scheduler = ScanScheduler::new(
            database_path,
            Arc::new(Mutex::new(std::collections::HashSet::new())),
            Arc::new(JmComicProviderState::new().unwrap()),
        );

        let started = Instant::now();
        scheduler
            .enqueue(ScanRequest {
                library_id: library.id,
                job_id,
                roots: vec![root],
                options: ScanOptions {
                    recursive: true,
                    mark_missing: true,
                },
            })
            .unwrap();
        let enqueue_elapsed = started.elapsed();
        let deadline = Instant::now() + Duration::from_secs(10 * 60);
        let mut reads_while_running = 0;
        loop {
            let jobs = db.list_scan_jobs().unwrap();
            let job = jobs.iter().find(|job| job.id == job_id).unwrap();
            if matches!(job.status.as_str(), "queued" | "running" | "cancelling") {
                let _ = db
                    .list_books(BookQuery {
                        search: None,
                        sort: Some("title".to_string()),
                        view: None,
                        favorite: None,
                        author: None,
                        tag: None,
                        category: None,
                        format: None,
                        status: Some("available".to_string()),
                        min_rating: None,
                        duplicates_only: None,
                        limit: Some(50),
                        offset: Some(0),
                    })
                    .unwrap();
                reads_while_running += 1;
            }
            if job.status == "complete" {
                println!(
                    "real background queue: enqueue {:?}, {} discovered, {} imported, {} failed in {:?}; {} foreground reads while active",
                    enqueue_elapsed,
                    job.discovered_count,
                    job.imported_count,
                    job.failed_count,
                    started.elapsed(),
                    reads_while_running
                );
                assert_eq!(job.failed_count, 0);
                assert!(reads_while_running > 0);
                break;
            }
            assert_ne!(job.status, "failed");
            assert!(
                Instant::now() < deadline,
                "background scan did not finish in time"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}
