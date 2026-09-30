use std::path::PathBuf;

use mangavault_desktop::title_repair::{
    apply_title_repairs, preview_title_repairs, protected_database_snapshot,
};
use rusqlite::{Connection, OpenFlags};

fn main() {
    let mut arguments = std::env::args_os().skip(1);
    let action = arguments
        .next()
        .and_then(|value| value.into_string().ok())
        .expect(
        "usage: title_repair_preview <preview|state|audit|apply> <database-path> [preview-token]",
    );
    let database_path = arguments
        .next()
        .map(PathBuf::from)
        .expect("database path is required");
    let result: Result<serde_json::Value, String> = if action == "preview" {
        preview_title_repairs(&database_path)
            .map_err(|error| error.to_string())
            .and_then(|preview| serde_json::to_value(preview).map_err(|error| error.to_string()))
    } else if action == "state" {
        protected_database_snapshot(&database_path)
            .map_err(|error| error.to_string())
            .and_then(|snapshot| serde_json::to_value(snapshot).map_err(|error| error.to_string()))
    } else if action == "audit" {
        audit_repair(&database_path)
    } else if action == "apply" {
        let token = arguments
            .next()
            .and_then(|value| value.into_string().ok())
            .expect("apply requires the approved preview token");
        preview_title_repairs(&database_path)
            .map_err(|error| error.to_string())
            .and_then(|preview| {
                let ids = preview
                    .candidates
                    .iter()
                    .filter(|candidate| candidate.default_selected)
                    .map(|candidate| candidate.book_id)
                    .collect::<Vec<_>>();
                apply_title_repairs(&database_path, &token, &ids)
                    .map_err(|error| error.to_string())
                    .and_then(|result| {
                        serde_json::to_value(result).map_err(|error| error.to_string())
                    })
            })
    } else {
        panic!("unknown action: {action}");
    };
    match result {
        Ok(result) => println!("{}", serde_json::to_string_pretty(&result).unwrap()),
        Err(error) => {
            eprintln!("title repair operation failed: {error}");
            std::process::exit(1);
        }
    }
}

fn audit_repair(database_path: &std::path::Path) -> Result<serde_json::Value, String> {
    let connection = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let quick_check = connection
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let history_count = connection
        .query_row(
            "SELECT COUNT(*) FROM metadata_history mh
             JOIN metadata_sources ms ON ms.id=mh.source_id
             WHERE ms.provider_id='mangavault.controlled-title-repair-v1'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let source_count = connection
        .query_row(
            "SELECT COUNT(*) FROM metadata_sources
             WHERE provider_id='mangavault.controlled-title-repair-v1'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let backup = connection
        .query_row(
            "SELECT snapshot_path, reason FROM backup_snapshots
             WHERE reason='title-repair' ORDER BY created_at DESC LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "quickCheck": quick_check,
        "repairSourceCount": source_count,
        "repairHistoryCount": history_count,
        "managedBackupPath": backup.0,
        "managedBackupReason": backup.1,
    }))
}
