pub mod archive;
mod cache;
mod commands;
pub mod db;
mod error;
pub mod extensions;
pub mod jmcomic;
pub mod jmcomic_metadata;
pub mod jmcomic_provider;
mod logs;
pub mod metadata;
pub mod models;
mod process;
mod reader;
mod scan_queue;
pub mod scanner;
mod services;
pub mod title_repair;

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use db::Database;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

const MAIN_TRAY_ID: &str = "main-tray";

pub(crate) struct NativeLabels {
    pub show: &'static str,
    pub hide: &'static str,
    pub quit: &'static str,
    pub comic_files: &'static str,
    pub choose_folder: &'static str,
    pub choose_files: &'static str,
    pub update_not_configured: &'static str,
}

pub(crate) fn native_labels(locale: &str) -> NativeLabels {
    if locale.to_ascii_lowercase().starts_with("en") {
        NativeLabels {
            show: "Show MangaVault",
            hide: "Hide Window",
            quit: "Quit",
            comic_files: "Comic files",
            choose_folder: "Choose Manga Folder",
            choose_files: "Choose Comic Files",
            update_not_configured: "Automatic updates are not configured for this offline build.",
        }
    } else {
        NativeLabels {
            show: "显示 MangaVault",
            hide: "隐藏窗口",
            quit: "退出",
            comic_files: "漫画文件",
            choose_folder: "选择漫画文件夹",
            choose_files: "选择漫画文件",
            update_not_configured: "当前离线版本尚未配置自动更新。",
        }
    }
}

pub struct AppState {
    pub db: Mutex<Database>,
    pub cancelled_scans: Arc<Mutex<HashSet<i64>>>,
    pub scan_scheduler: scan_queue::ScanScheduler,
    pub jmcomic_discovery: Arc<tokio::sync::OnceCell<Vec<jmcomic::JmComicSourceCandidate>>>,
    pub jmcomic_provider: Arc<jmcomic_provider::JmComicProviderState>,
    pub metadata_batch_cancelled: Arc<AtomicBool>,
    pub metadata_batch_running: Arc<AtomicBool>,
    pub launch_paths: Mutex<Vec<PathBuf>>,
    pub had_existing_database: bool,
    pub reset_outcome: Mutex<Option<models::DatabaseResetOutcome>>,
}

pub fn run() {
    #[cfg(debug_assertions)]
    let log_plugin = tauri_plugin_log::Builder::new().build();
    #[cfg(not(debug_assertions))]
    let log_plugin = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::LogDir {
                file_name: Some("MangaVault Desktop".into()),
            },
        ))
        .level(tauri_plugin_log::log::LevelFilter::Info)
        .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = launch_paths_from_args(argv.into_iter().map(OsString::from));
            let payload = paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>();
            if !payload.is_empty() {
                let _ = app.emit("associated-file-opened", payload);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }))
        .plugin(log_plugin)
        .setup(|app| {
            tauri_plugin_log::log::info!(
                "MangaVault Desktop {} startup",
                env!("CARGO_PKG_VERSION")
            );
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|err| format!("failed to resolve bundled resource directory: {err}"))?;
            let bundled_tools_dir = resource_dir.join("tools");
            if bundled_tools_dir.is_dir() {
                // Release bundles ship their reader tools here; PATH remains a fallback for development.
                std::env::set_var("MANGAVAULT_BUNDLED_TOOLS_DIR", bundled_tools_dir);
            }
            let launch_paths = launch_paths_from_args(std::env::args_os().skip(1));
            let log_dir = app
                .path()
                .app_log_dir()
                .map_err(|err| format!("failed to resolve log directory: {err}"))?;
            logs::install_panic_hook(log_dir);
            let db_path = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("failed to resolve app data directory: {err}"))?
                .join("mangavault.sqlite3");
            let database_existed_at_startup = db_path.exists();
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let restored_database_backup = Database::apply_pending_restore(&db_path)?;
            let reset_outcome = Database::apply_pending_reset(&db_path)?;
            let (database, recovery_backup) = Database::open_with_recovery(&db_path)?;
            let pre_migration_backup = database.migrate_and_seed_with_snapshot()?;
            if let Some(outcome) = reset_outcome.as_ref() {
                database.register_reset_snapshots(outcome)?;
            }
            let summary = database.local_data_summary()?;
            let reset_succeeded = reset_outcome
                .as_ref()
                .map(|outcome| outcome.success)
                .unwrap_or(false);
            let has_user_data = summary.libraries > 0
                || summary.books > 0
                || summary.reading_history > 0
                || summary.reading_progress > 0
                || summary.bookmarks > 0;
            if !database_existed_at_startup || reset_succeeded || !has_user_data {
                database.acknowledge_existing_data_notice()?;
            }
            let interrupted_jobs = database.mark_interrupted_scan_jobs()?;
            let locale = database.locale()?;
            let cancelled_scans = Arc::new(Mutex::new(HashSet::new()));
            let jmcomic_provider = Arc::new(jmcomic_provider::JmComicProviderState::new()?);
            let scan_scheduler = scan_queue::ScanScheduler::new(
                db_path,
                cancelled_scans.clone(),
                jmcomic_provider.clone(),
            );
            if let Some(path) = recovery_backup {
                tauri_plugin_log::log::warn!(
                    "database recovery created corrupt backup at {}",
                    path.to_string_lossy()
                );
            }
            if let Some(path) = restored_database_backup {
                tauri_plugin_log::log::warn!(
                    "database restore completed; the previous database was backed up at {}",
                    path.to_string_lossy()
                );
            }
            if let Some(path) = pre_migration_backup {
                tauri_plugin_log::log::warn!(
                    "database schema upgrade created pre-migration backup at {}",
                    path.to_string_lossy()
                );
            }
            if interrupted_jobs > 0 {
                tauri_plugin_log::log::warn!(
                    "marked {interrupted_jobs} interrupted scan jobs for retry"
                );
            }
            app.manage(AppState {
                db: Mutex::new(database),
                cancelled_scans,
                scan_scheduler,
                jmcomic_discovery: Arc::new(tokio::sync::OnceCell::new()),
                jmcomic_provider,
                metadata_batch_cancelled: Arc::new(AtomicBool::new(false)),
                metadata_batch_running: Arc::new(AtomicBool::new(false)),
                launch_paths: Mutex::new(launch_paths),
                had_existing_database: database_existed_at_startup && !reset_succeeded,
                reset_outcome: Mutex::new(reset_outcome),
            });
            install_tray(app, &locale)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::check_for_updates,
            commands::choose_import_folder,
            commands::choose_import_files,
            commands::import_folder,
            commands::import_paths,
            commands::take_launch_paths,
            commands::rescan_library,
            commands::cancel_scan,
            commands::retry_scan,
            commands::list_scan_jobs,
            commands::list_scan_failures,
            commands::get_format_capabilities,
            commands::choose_jmcomic_database,
            commands::discover_jmcomic_sources,
            commands::preview_jmcomic_matches,
            commands::import_jmcomic_identities,
            commands::get_jmcomic_provider_status,
            commands::get_jmcomic_metadata,
            commands::get_jmcomic_book_source,
            commands::list_jmcomic_metadata_jobs,
            commands::preview_jmcomic_metadata_batch,
            commands::run_jmcomic_metadata_batch,
            commands::cancel_jmcomic_metadata_batch,
            commands::refresh_jmcomic_metadata,
            commands::list_libraries,
            commands::get_library_removal_preview,
            commands::remove_library,
            commands::purge_missing_books,
            commands::get_deleted_book_cleanup_preview,
            commands::purge_deleted_books,
            commands::list_books,
            commands::get_book,
            commands::get_book_by_path,
            commands::update_book_metadata,
            commands::toggle_favorite,
            commands::set_rating,
            commands::list_tags,
            commands::list_categories,
            commands::list_authors,
            commands::list_formats,
            commands::set_book_tags,
            commands::get_book_pages,
            commands::get_book_chapters,
            commands::get_page_data,
            commands::get_thumbnail_data,
            commands::save_progress,
            commands::record_reading_opened,
            commands::get_progress,
            commands::add_bookmark,
            commands::remove_bookmark,
            commands::list_bookmarks,
            commands::list_history,
            commands::list_recent_reading,
            commands::remove_recent_reading,
            commands::reset_reading_progress,
            commands::mark_book_read,
            commands::list_reader_profiles,
            commands::reader_settings_scope_counts,
            commands::list_smart_collections,
            commands::get_database_health,
            commands::backup_database,
            commands::list_backup_snapshots,
            commands::get_database_restore_status,
            commands::schedule_database_restore,
            commands::cancel_database_restore,
            commands::optimize_database,
            commands::list_log_files,
            commands::open_log_dir,
            commands::report_frontend_error,
            commands::clear_upscale_cache,
            commands::clear_application_caches,
            commands::clear_reading_history,
            commands::reset_application_settings,
            commands::list_feature_flags,
            commands::get_license_state,
            commands::list_telemetry_settings,
            commands::get_ocr_translation_status,
            commands::get_sync_status,
            commands::get_plugin_status,
            commands::get_settings,
            commands::set_setting,
            commands::get_startup_data_status,
            commands::acknowledge_existing_data,
            commands::schedule_database_reset,
            commands::restart_application,
            commands::open_path_in_shell
        ])
        .run(tauri::generate_context!())
        .expect("error while running MangaVault Desktop");
}

fn launch_paths_from_args(args: impl IntoIterator<Item = OsString>) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|arg| !arg.to_string_lossy().starts_with('-'))
        .filter_map(|arg| PathBuf::from(arg).canonicalize().ok())
        .filter(|path| path.is_dir() || archive::is_book_file(path))
        .collect()
}

fn install_tray(app: &mut tauri::App, locale: &str) -> tauri::Result<()> {
    let menu = tray_menu(app.handle(), locale)?;
    let mut builder = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("MangaVault Desktop")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn tray_menu(app: &AppHandle, locale: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let labels = native_labels(locale);
    let show = MenuItem::with_id(app, "show", labels.show, true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", labels.hide, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&show, &hide, &quit])
}

pub(crate) fn update_tray_menu(app: &AppHandle, locale: &str) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        tray.set_menu(Some(tray_menu(app, locale)?))?;
    }
    Ok(())
}

#[cfg(test)]
mod native_label_tests {
    use super::{launch_paths_from_args, native_labels};
    use std::ffi::OsString;

    #[test]
    fn selects_native_labels_from_ui_locale() {
        let chinese = native_labels("zh-CN");
        assert_eq!(chinese.comic_files, "漫画文件");
        assert_eq!(chinese.choose_folder, "选择漫画文件夹");
        assert_eq!(chinese.quit, "退出");

        let english = native_labels("en-US");
        assert_eq!(english.comic_files, "Comic files");
        assert_eq!(english.choose_files, "Choose Comic Files");
        assert_eq!(english.quit, "Quit");
    }

    #[test]
    fn accepts_only_supported_existing_launch_paths() {
        let dir = tempfile::tempdir().unwrap();
        let supported = dir.path().join("book.cbz");
        let unsupported = dir.path().join("notes.txt");
        std::fs::write(&supported, b"archive").unwrap();
        std::fs::write(&unsupported, b"notes").unwrap();

        let paths = launch_paths_from_args(vec![
            OsString::from("--flag"),
            supported.clone().into_os_string(),
            unsupported.into_os_string(),
        ]);

        assert_eq!(paths, vec![supported.canonicalize().unwrap()]);
    }
}
