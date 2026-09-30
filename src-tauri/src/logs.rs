use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use crate::{error::Result, models::LogFileInfo};

pub fn list_log_files_in_dir(dir: &Path) -> Result<Vec<LogFileInfo>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = entry.metadata()?;
        let modified_at = metadata
            .modified()
            .ok()
            .map(|time| DateTime::<Utc>::from(time).to_rfc3339());
        files.push(LogFileInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            byte_size: metadata.len() as i64,
            modified_at,
        });
    }
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at).then(a.name.cmp(&b.name)));
    Ok(files)
}

pub fn write_crash_report(dir: &Path, kind: &str, details: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!(
        "crash-{}-{kind}.log",
        Utc::now().format("%Y%m%d%H%M%S%3f")
    ));
    std::fs::write(
        &path,
        format!(
            "timestamp={}\nkind={kind}\n\n{details}\n",
            Utc::now().to_rfc3339()
        ),
    )?;
    Ok(path)
}

pub fn install_panic_hook(log_dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_else(|| "unknown".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic payload".to_string());
        let _ = write_crash_report(
            &log_dir,
            "rust",
            &format!("location={location}\npanic={payload}"),
        );
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_log_files_without_descending_into_subdirectories() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mangavault.log"), b"log").unwrap();
        std::fs::create_dir(dir.path().join("nested")).unwrap();
        std::fs::write(dir.path().join("nested").join("hidden.log"), b"hidden").unwrap();

        let files = list_log_files_in_dir(dir.path()).unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "mangavault.log");
        assert_eq!(files[0].byte_size, 3);
    }

    #[test]
    fn missing_log_directory_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let files = list_log_files_in_dir(&dir.path().join("missing")).unwrap();

        assert!(files.is_empty());
    }

    #[test]
    fn writes_a_timestamped_crash_report() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_crash_report(dir.path(), "frontend", "component stack").unwrap();

        assert!(path.exists());
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .contains("component stack"));
    }
}
