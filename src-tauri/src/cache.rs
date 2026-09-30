use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::Result;

static CACHE_PRUNE_LOCK: Mutex<()> = Mutex::new(());

pub fn prune_directory_to_size(
    cache_root: &Path,
    max_bytes: u64,
    keep: Option<&Path>,
) -> Result<usize> {
    Ok(prune_directory_to_size_with_paths(cache_root, max_bytes, keep)?.len())
}

pub fn prune_directory_to_size_with_paths(
    cache_root: &Path,
    max_bytes: u64,
    keep: Option<&Path>,
) -> Result<Vec<PathBuf>> {
    let _guard = CACHE_PRUNE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !cache_root.exists() {
        return Ok(Vec::new());
    }
    let root = cache_root.canonicalize()?;
    let keep = keep.and_then(|path| path.canonicalize().ok());
    let mut files = std::fs::read_dir(&root)?
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            if entry.file_name().to_string_lossy().contains(".tmp-") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            metadata.is_file().then_some((
                entry.path(),
                metadata.len(),
                metadata
                    .modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            ))
        })
        .collect::<Vec<_>>();
    let mut total = files.iter().map(|(_, size, _)| *size).sum::<u64>();
    if total <= max_bytes {
        return Ok(Vec::new());
    }
    files.sort_by_key(|(_, _, modified)| *modified);
    let mut removed = Vec::new();
    for (path, size, _) in files {
        if total <= max_bytes {
            break;
        }
        let canonical = match path.canonicalize() {
            Ok(path) => path,
            Err(_) => continue,
        };
        if keep.as_ref().is_some_and(|keep| keep == &canonical) || !canonical.starts_with(&root) {
            continue;
        }
        if std::fs::remove_file(&canonical).is_ok() {
            total = total.saturating_sub(size);
            removed.push(canonical);
        }
    }
    Ok(removed)
}

pub fn remove_cache_files(cache_root: &Path, paths: &[PathBuf]) -> Result<usize> {
    if !cache_root.exists() {
        return Ok(0);
    }
    let root = cache_root.canonicalize()?;
    let mut removed = 0;
    for path in paths {
        if can_remove_cache_file(&root, path) {
            std::fs::remove_file(path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn remove_upscale_cache_files(cache_root: &Path, paths: &[PathBuf]) -> Result<usize> {
    remove_cache_files(cache_root, paths)
}

pub fn clear_cache_directory(cache_root: &Path) -> Result<usize> {
    let _guard = CACHE_PRUNE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !cache_root.exists() {
        return Ok(0);
    }
    let root = cache_root.canonicalize()?;
    let mut entries = std::fs::read_dir(&root)?
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    entries.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

    let mut removed = 0;
    for path in entries {
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || metadata.is_file() {
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
            continue;
        }
        if metadata.is_dir() {
            let canonical = match path.canonicalize() {
                Ok(path) if path.starts_with(&root) => path,
                _ => continue,
            };
            let nested_removed = clear_cache_directory_unlocked(&canonical, &root)?;
            removed += nested_removed;
            let _ = std::fs::remove_dir(&canonical);
        }
    }
    Ok(removed)
}

fn clear_cache_directory_unlocked(directory: &Path, root: &Path) -> Result<usize> {
    let mut removed = 0;
    for entry in std::fs::read_dir(directory)?.filter_map(std::result::Result::ok) {
        let path = entry.path();
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || metadata.is_file() {
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
            continue;
        }
        if metadata.is_dir() {
            let canonical = match path.canonicalize() {
                Ok(path) if path.starts_with(root) => path,
                _ => continue,
            };
            removed += clear_cache_directory_unlocked(&canonical, root)?;
            let _ = std::fs::remove_dir(&canonical);
        }
    }
    Ok(removed)
}

fn can_remove_cache_file(canonical_cache_root: &Path, path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    canonical.is_file() && canonical.starts_with(canonical_cache_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_only_files_inside_upscale_cache_root() {
        let dir = tempfile::tempdir().unwrap();
        let cache_root = dir.path().join("upscale");
        let outside = dir.path().join("outside.txt");
        std::fs::create_dir_all(&cache_root).unwrap();
        let inside = cache_root.join("page.webp");
        std::fs::write(&inside, b"cache").unwrap();
        std::fs::write(&outside, b"original").unwrap();

        let removed =
            remove_upscale_cache_files(&cache_root, &[inside.clone(), outside.clone()]).unwrap();

        assert_eq!(removed, 1);
        assert!(!inside.exists());
        assert!(outside.exists());
    }

    #[test]
    fn missing_upscale_cache_root_removes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let removed = remove_upscale_cache_files(&dir.path().join("missing"), &[]).unwrap();

        assert_eq!(removed, 0);
    }

    #[test]
    fn prunes_oldest_cache_files_and_keeps_active_page() {
        let dir = tempfile::tempdir().unwrap();
        let cache_root = dir.path().join("reader-pages");
        std::fs::create_dir_all(&cache_root).unwrap();
        let oldest = cache_root.join("oldest.png");
        let active = cache_root.join("active.png");
        std::fs::write(&oldest, [0_u8; 8]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        std::fs::write(&active, [0_u8; 8]).unwrap();

        let removed = prune_directory_to_size(&cache_root, 8, Some(&active)).unwrap();

        assert_eq!(removed, 1);
        assert!(!oldest.exists());
        assert!(active.exists());
    }

    #[test]
    fn reports_exact_evicted_cache_paths() {
        let dir = tempfile::tempdir().unwrap();
        let cache_root = dir.path().join("thumbnails");
        std::fs::create_dir_all(&cache_root).unwrap();
        let oldest = cache_root.join("oldest.jpg");
        let active = cache_root.join("active.jpg");
        std::fs::write(&oldest, [0_u8; 8]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        std::fs::write(&active, [0_u8; 8]).unwrap();

        let removed = prune_directory_to_size_with_paths(&cache_root, 8, Some(&active)).unwrap();

        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].file_name(), oldest.file_name());
        assert!(active.exists());
    }

    #[test]
    fn clears_only_the_requested_cache_directory() {
        let dir = tempfile::tempdir().unwrap();
        let cache_root = dir.path().join("thumbnails");
        let nested = cache_root.join("nested");
        let outside = dir.path().join("original.png");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(cache_root.join("cover.jpg"), b"cover").unwrap();
        std::fs::write(nested.join("page.jpg"), b"page").unwrap();
        std::fs::write(&outside, b"original").unwrap();

        let removed = clear_cache_directory(&cache_root).unwrap();

        assert_eq!(removed, 2);
        assert!(cache_root.exists());
        assert!(std::fs::read_dir(&cache_root).unwrap().next().is_none());
        assert!(outside.exists());
    }
}
