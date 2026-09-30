use std::cmp::Ordering as CmpOrdering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{DateTime, Utc};
use regex::Regex;
use walkdir::WalkDir;

use crate::archive::{
    is_book_file, is_image, list_archive_pages_with_limits, ArchiveEntry, ArchiveLimits,
};
use crate::db::{normalize_sort_title, ScannedBook, ScannedPage};
use crate::error::Result;

#[derive(Debug, Default, Clone)]
pub struct ScanStats {
    pub discovered: i64,
    pub imported: i64,
    pub failed: i64,
    pub failures: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct DiscoveryResult {
    pub candidates: Vec<PathBuf>,
    pub failures: Vec<String>,
    pub cancelled: bool,
}

pub fn discover(root: &Path, recursive: bool, cancel: &AtomicBool) -> Vec<PathBuf> {
    discover_with_progress(root, recursive, cancel, |_| {})
}

pub fn discover_with_progress(
    root: &Path,
    recursive: bool,
    cancel: &AtomicBool,
    on_progress: impl FnMut(usize),
) -> Vec<PathBuf> {
    discover_with_progress_with_cancel(
        root,
        recursive,
        &|| cancel.load(Ordering::Relaxed),
        on_progress,
    )
    .candidates
}

pub fn discover_with_progress_with_cancel(
    root: &Path,
    recursive: bool,
    is_cancelled: &dyn Fn() -> bool,
    mut on_progress: impl FnMut(usize),
) -> DiscoveryResult {
    if root.is_file() {
        if is_book_file(root) {
            on_progress(1);
            return DiscoveryResult {
                candidates: vec![root.to_path_buf()],
                ..DiscoveryResult::default()
            };
        }
        return DiscoveryResult::default();
    }
    let mut candidates = HashSet::new();
    let mut failures = Vec::new();
    // A single walk discovers archives and image folders. For non-recursive
    // imports, depth two preserves detection of images inside a direct child
    // folder while archives remain limited to the selected root.
    let max_depth = if recursive { usize::MAX } else { 2 };
    for entry in WalkDir::new(root).max_depth(max_depth).into_iter() {
        if is_cancelled() {
            return DiscoveryResult {
                candidates: candidates.into_iter().collect(),
                failures,
                cancelled: true,
            };
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                failures.push(error.to_string());
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let candidate = if is_book_file(path) && (recursive || entry.depth() <= 1) {
            Some(path.to_path_buf())
        } else if is_image(path) {
            Some(logical_book_root_for_image_dir(
                path.parent().unwrap_or(path),
            ))
        } else {
            None
        };
        if let Some(candidate) = candidate.filter(|_| recursive || entry.depth() <= 2) {
            if candidates.insert(candidate) {
                report_discovery_progress(candidates.len(), &mut on_progress);
            }
        }
    }
    let mut candidates = candidates.into_iter().collect::<Vec<_>>();
    candidates.sort();
    on_progress(candidates.len());
    DiscoveryResult {
        candidates,
        failures,
        cancelled: false,
    }
}

pub fn scan_candidate(library_id: i64, path: &Path) -> Result<ScannedBook> {
    scan_candidate_with_limits(library_id, path, ArchiveLimits::default())
}

pub fn scan_candidate_with_limits(
    library_id: i64,
    path: &Path,
    limits: ArchiveLimits,
) -> Result<ScannedBook> {
    let metadata = fs::metadata(path)?;
    let modified_at = metadata
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
        .map(|time| time.to_rfc3339());
    let format = if metadata.is_dir() {
        "folder".to_string()
    } else {
        path.extension()
            .and_then(|v| v.to_str())
            .unwrap_or("unknown")
            .to_ascii_lowercase()
    };
    let entries = if metadata.is_dir() {
        list_folder_images(path)?
    } else {
        list_archive_pages_with_limits(path, limits)?
    };
    let file_size = if metadata.is_file() {
        metadata.len() as i64
    } else {
        entries
            .iter()
            .filter_map(|entry| entry.byte_size)
            .sum::<i64>()
    };
    let pages = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| ScannedPage {
            page_index: index as i64,
            source_path: entry.path.clone(),
            width: None,
            height: None,
            byte_size: entry.byte_size,
        })
        .collect::<Vec<_>>();
    let file_name = if metadata.is_dir() {
        path.file_name()
    } else {
        path.file_stem()
    }
    .and_then(|v| v.to_str())
    .unwrap_or("Untitled");
    let parsed = parse_title(file_name);
    let author = if metadata.is_dir() && preferred_version_dir(path).is_some() {
        author_from_parent_dir(path).or(parsed.author)
    } else {
        parsed.author
    };
    let checksum = if metadata.is_dir() {
        Some(folder_content_checksum(path, &entries)?)
    } else {
        quick_checksum(path).ok()
    };
    Ok(ScannedBook {
        library_id,
        title: parsed.title.clone(),
        sort_title: normalize_sort_title(&parsed.title),
        author,
        volume: parsed.volume,
        chapter: parsed.chapter,
        path: path.to_string_lossy().to_string(),
        format,
        file_size,
        modified_at,
        page_count: pages.len() as i64,
        checksum,
        pages,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTitle {
    pub title: String,
    pub author: Option<String>,
    pub volume: Option<f64>,
    pub chapter: Option<f64>,
}

pub fn parse_title(file_name: &str) -> ParsedTitle {
    let title = if file_name.trim().is_empty() {
        "Untitled".to_string()
    } else {
        file_name.to_string()
    };
    let author_re = Regex::new(r"^\[(?P<author>[^\]]+)\]").unwrap();
    let volume_re =
        Regex::new(r"(?i)(?:^|[^\p{L}\p{N}])(?:vol(?:ume)?|v)\.?\s*(?P<num>\d+(?:\.\d+)?)")
            .unwrap();
    let chapter_re =
        Regex::new(r"(?i)(?:^|[^\p{L}\p{N}])(?:chapter|ch)\.?\s*(?P<num>\d+(?:\.\d+)?)").unwrap();
    let cn_volume_re = Regex::new(r"(?:第\s*)?(?P<num>\d+(?:\.\d+)?)\s*[卷冊册]").unwrap();
    let cn_chapter_re = Regex::new(r"第\s*(?P<num>\d+(?:\.\d+)?)\s*[话話章篇回]").unwrap();
    let bare_japanese_chapter_re = Regex::new(r"(?P<num>\d+(?:\.\d+)?)\s*話").unwrap();
    let author = author_re
        .captures(&title)
        .and_then(|caps| caps.name("author").map(|v| v.as_str().trim().to_string()));
    let volume = volume_re
        .captures(&title)
        .and_then(|caps| caps.name("num"))
        .or_else(|| {
            cn_volume_re
                .captures(&title)
                .and_then(|caps| caps.name("num"))
        })
        .and_then(|v| v.as_str().parse::<f64>().ok());
    let chapter = chapter_re
        .captures(&title)
        .and_then(|caps| caps.name("num"))
        .or_else(|| {
            cn_chapter_re
                .captures(&title)
                .and_then(|caps| caps.name("num"))
        })
        .or_else(|| {
            bare_japanese_chapter_re
                .captures(&title)
                .and_then(|caps| caps.name("num"))
        })
        .and_then(|v| v.as_str().parse::<f64>().ok());
    ParsedTitle {
        title,
        author,
        volume,
        chapter,
    }
}

fn report_discovery_progress(count: usize, on_progress: &mut impl FnMut(usize)) {
    if count <= 5 || count % 25 == 0 {
        on_progress(count);
    }
}

fn list_folder_images(path: &Path) -> Result<Vec<ArchiveEntry>> {
    let mut direct_entries = list_direct_folder_images(path, path)?;
    if !direct_entries.is_empty() {
        direct_entries.sort_by(|a, b| natural_path_cmp(&a.path, &b.path));
        return Ok(direct_entries);
    }
    if !version_directories(path).is_empty() {
        return list_versioned_folder_images(path);
    }
    Ok(Vec::new())
}

fn list_direct_folder_images(root: &Path, path: &Path) -> Result<Vec<ArchiveEntry>> {
    Ok(fs::read_dir(path)?
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_image(path))
        .filter_map(|file| {
            let name = file.file_name()?.to_str()?.to_string();
            let size = file.metadata().ok().map(|v| v.len() as i64);
            Some(ArchiveEntry {
                path: path_relative_to(root, &file).unwrap_or(name),
                byte_size: size,
            })
        })
        .collect::<Vec<_>>())
}

fn list_versioned_folder_images(book_root: &Path) -> Result<Vec<ArchiveEntry>> {
    let mut versions = version_directories(book_root);
    versions.sort_by(|left, right| {
        version_rank(left)
            .cmp(&version_rank(right))
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });
    let mut pages = HashMap::<String, ArchiveEntry>::new();
    for version_dir in versions {
        for file in WalkDir::new(&version_dir)
            .min_depth(1)
            .into_iter()
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path().to_path_buf())
            .filter(|path| path.is_file() && is_image(path))
        {
            let Some(key) = logical_page_key(&version_dir, &file) else {
                continue;
            };
            let Some(path) = path_relative_to(book_root, &file) else {
                continue;
            };
            pages.insert(
                key,
                ArchiveEntry {
                    path,
                    byte_size: file.metadata().ok().map(|value| value.len() as i64),
                },
            );
        }
    }
    let mut entries = pages.into_iter().collect::<Vec<_>>();
    entries.sort_by(|(left, _), (right, _)| natural_path_cmp(left, right));
    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}

fn logical_page_key(version_dir: &Path, file: &Path) -> Option<String> {
    let mut relative = file.strip_prefix(version_dir).ok()?.to_path_buf();
    relative.set_extension("");
    Some(relative.to_string_lossy().replace('\\', "/").to_lowercase())
}

pub(crate) fn logical_book_root_for_image_dir(path: &Path) -> PathBuf {
    if is_version_dir(path) {
        return path.parent().unwrap_or(path).to_path_buf();
    }
    if let Some(parent) = path.parent() {
        if is_version_dir(parent) {
            return parent.parent().unwrap_or(parent).to_path_buf();
        }
    }
    path.to_path_buf()
}

fn preferred_version_dir(book_root: &Path) -> Option<PathBuf> {
    version_directories(book_root)
        .into_iter()
        .max_by_key(|path| version_rank(path))
}

fn version_directories(book_root: &Path) -> Vec<PathBuf> {
    fs::read_dir(book_root)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && is_version_dir(path))
        .collect()
}

fn is_version_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| version_rank_name(name) > 0)
}

fn version_rank(path: &Path) -> i32 {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(version_rank_name)
        .unwrap_or(0)
}

fn version_rank_name(name: &str) -> i32 {
    let normalized = name.to_ascii_lowercase();
    if normalized.contains("waifu2x")
        || normalized.contains("real-esrgan")
        || normalized.contains("realesrgan")
        || normalized.contains("realcugan")
        || normalized.contains("anime4k")
        || normalized.contains("swinir")
        || normalized.contains("upscayl")
    {
        return 30;
    }
    if normalized.contains("upscale")
        || normalized.contains("upscaled")
        || normalized.contains("super-resolution")
        || normalized.contains("super_resolution")
        || normalized.contains("sr")
        || name.contains("超分")
        || name.contains("高清")
        || name.contains("增强")
    {
        return 20;
    }
    if normalized == "original"
        || normalized == "orig"
        || normalized == "raw"
        || normalized == "source"
        || name.contains("原图")
        || name.contains("原始")
        || name.contains("原版")
    {
        return 10;
    }
    0
}

fn path_relative_to(root: &Path, file: &Path) -> Option<String> {
    file.strip_prefix(root)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn author_from_parent_dir(path: &Path) -> Option<String> {
    let author = path.parent()?.file_name()?.to_str()?.trim();
    if author.is_empty() || is_placeholder_author_dir(author) {
        return None;
    }
    Some(author.to_string())
}

fn is_placeholder_author_dir(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "default"
            | "unknown"
            | "misc"
            | "mixed"
            | "other"
            | "others"
            | "unclassified"
            | "uncategorized"
    ) || matches!(name.trim(), "默认" | "未知" | "未分类" | "其他" | "杂项")
}

fn natural_path_cmp(left: &str, right: &str) -> CmpOrdering {
    let mut left_chars = left.chars().peekable();
    let mut right_chars = right.chars().peekable();
    loop {
        match (left_chars.peek(), right_chars.peek()) {
            (None, None) => return CmpOrdering::Equal,
            (None, Some(_)) => return CmpOrdering::Less,
            (Some(_), None) => return CmpOrdering::Greater,
            (Some(left_ch), Some(right_ch))
                if left_ch.is_ascii_digit() && right_ch.is_ascii_digit() =>
            {
                let left_number = take_number(&mut left_chars);
                let right_number = take_number(&mut right_chars);
                let number_order = compare_number_tokens(&left_number, &right_number);
                if number_order != CmpOrdering::Equal {
                    return number_order;
                }
            }
            _ => {
                let left_text = take_text(&mut left_chars);
                let right_text = take_text(&mut right_chars);
                let text_order = left_text
                    .to_ascii_lowercase()
                    .cmp(&right_text.to_ascii_lowercase());
                if text_order != CmpOrdering::Equal {
                    return text_order;
                }
            }
        }
    }
}

fn take_number(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut value = String::new();
    while chars.peek().is_some_and(char::is_ascii_digit) {
        if let Some(ch) = chars.next() {
            value.push(ch);
        }
    }
    value
}

fn take_text(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut value = String::new();
    while chars.peek().is_some_and(|ch| !ch.is_ascii_digit()) {
        if let Some(ch) = chars.next() {
            value.push(ch);
        }
    }
    value
}

fn compare_number_tokens(left: &str, right: &str) -> CmpOrdering {
    let left_trimmed = left.trim_start_matches('0');
    let right_trimmed = right.trim_start_matches('0');
    let left_normalized = if left_trimmed.is_empty() {
        "0"
    } else {
        left_trimmed
    };
    let right_normalized = if right_trimmed.is_empty() {
        "0"
    } else {
        right_trimmed
    };
    left_normalized
        .len()
        .cmp(&right_normalized.len())
        .then_with(|| left_normalized.cmp(right_normalized))
        .then_with(|| left.len().cmp(&right.len()))
}

fn quick_checksum(path: &Path) -> Result<String> {
    if path.is_dir() {
        return Ok(blake3::hash(path.to_string_lossy().as_bytes())
            .to_hex()
            .to_string());
    }
    let mut file = fs::File::open(path)?;
    let file_len = file.metadata()?.len();
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"mangavault-quick-checksum-v2");
    hasher.update(&file_len.to_le_bytes());
    if file_len > QUICK_CHECKSUM_SAMPLE_BYTES * 3 {
        hash_file_sample(&mut file, &mut hasher, 0)?;
        hash_file_sample(
            &mut file,
            &mut hasher,
            file_len
                .saturating_div(2)
                .saturating_sub(QUICK_CHECKSUM_SAMPLE_BYTES / 2),
        )?;
        hash_file_sample(
            &mut file,
            &mut hasher,
            file_len.saturating_sub(QUICK_CHECKSUM_SAMPLE_BYTES),
        )?;
        return Ok(hasher.finalize().to_hex().to_string());
    }
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

const QUICK_CHECKSUM_SAMPLE_BYTES: u64 = 64 * 1024;
const FOLDER_FINGERPRINT_MAX_TOTAL_BYTES: usize = 128 * 1024;
const FOLDER_FINGERPRINT_MAX_SEGMENT_BYTES: usize = 256;

fn folder_content_checksum(root: &Path, entries: &[ArchiveEntry]) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"mangavault-folder-content-checksum-v2");
    hasher.update(&(entries.len() as u64).to_le_bytes());
    let segment_bytes = folder_fingerprint_segment_bytes(entries.len());
    for entry in entries {
        hasher.update(entry.path.as_bytes());
        hasher.update(&[0]);
        hasher.update(&entry.byte_size.unwrap_or(-1).to_le_bytes());
        hasher.update(&[0xff]);
        let mut file = fs::File::open(root.join(&entry.path))?;
        hash_folder_file_segments(&mut file, &mut hasher, segment_bytes)?;
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn folder_fingerprint_segment_bytes(entry_count: usize) -> usize {
    let divisor = entry_count.saturating_mul(3).max(1);
    (FOLDER_FINGERPRINT_MAX_TOTAL_BYTES / divisor).clamp(1, FOLDER_FINGERPRINT_MAX_SEGMENT_BYTES)
}

fn hash_folder_file_segments(
    file: &mut fs::File,
    hasher: &mut blake3::Hasher,
    segment_bytes: usize,
) -> Result<()> {
    let file_len = file.metadata()?.len();
    let middle = file_len.saturating_sub(segment_bytes as u64) / 2;
    let tail = file_len.saturating_sub(segment_bytes as u64);
    let mut offsets = vec![0, middle, tail];
    offsets.sort_unstable();
    offsets.dedup();
    let mut buffer = vec![0_u8; segment_bytes];
    for offset in offsets {
        file.seek(SeekFrom::Start(offset))?;
        let read = file.read(&mut buffer)?;
        hasher.update(&offset.to_le_bytes());
        hasher.update(&(read as u64).to_le_bytes());
        hasher.update(&buffer[..read]);
        hasher.update(&[0xfe]);
    }
    Ok(())
}

fn hash_file_sample(file: &mut fs::File, hasher: &mut blake3::Hasher, offset: u64) -> Result<()> {
    file.seek(SeekFrom::Start(offset))?;
    hasher.update(&offset.to_le_bytes());
    let mut remaining = QUICK_CHECKSUM_SAMPLE_BYTES as usize;
    let mut buffer = [0_u8; 16 * 1024];
    while remaining > 0 {
        let chunk_len = remaining.min(buffer.len());
        let read = file.read(&mut buffer[..chunk_len])?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        remaining -= read;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn parses_volume_and_chapter() {
        let parsed = parse_title("[Author] Orbital Kids Vol. 02 Ch. 10");
        assert_eq!(parsed.author.as_deref(), Some("Author"));
        assert_eq!(parsed.title, "[Author] Orbital Kids Vol. 02 Ch. 10");
        assert_eq!(parsed.volume, Some(2.0));
        assert_eq!(parsed.chapter, Some(10.0));
    }

    #[test]
    fn parses_chinese_volume_and_chapter_names() {
        let parsed = parse_title("[藤本树] 链锯人 第02卷 第17话");
        assert_eq!(parsed.author.as_deref(), Some("藤本树"));
        assert_eq!(parsed.title, "[藤本树] 链锯人 第02卷 第17话");
        assert_eq!(parsed.volume, Some(2.0));
        assert_eq!(parsed.chapter, Some(17.0));

        let traditional = parse_title("葬送的芙莉蓮 88話");
        assert_eq!(traditional.title, "葬送的芙莉蓮 88話");
        assert_eq!(traditional.chapter, Some(88.0));

        let booklet = parse_title("迷宫饭 第03册");
        assert_eq!(booklet.title, "迷宫饭 第03册");
        assert_eq!(booklet.volume, Some(3.0));
    }

    #[test]
    fn preserves_event_codes_punctuation_and_legal_brackets() {
        for title in [
            "(C79) [社团] K-ON!",
            "(C100) [作者] E-Note",
            "(C107) [作者] 作品名",
            "（C107）[作者] 全角括号",
            "(COMITIA145) [作者] 作品名",
            "(COMIC1☆25) [作者] 作品名",
            "23.4",
            "1-4",
            "标题（副标题）",
            "Title (Special Edition)",
        ] {
            let parsed = parse_title(title);
            assert_eq!(parsed.title, title);
            assert_eq!(parsed.chapter, None, "unexpected chapter for {title}");
        }
    }

    #[test]
    fn only_extracts_explicit_chapter_markers_without_changing_title() {
        for (title, chapter) in [
            ("作品 Chapter 12", 12.0),
            ("作品 Ch.12", 12.0),
            ("作品 ch12", 12.0),
            ("作品 第12话", 12.0),
            ("作品 第12章", 12.0),
            ("作品 第12話", 12.0),
            ("作品 第12篇", 12.0),
            ("作品 12話", 12.0),
            ("作品 第12回", 12.0),
            ("(C107) 作品 Chapter 3", 3.0),
        ] {
            let parsed = parse_title(title);
            assert_eq!(parsed.title, title);
            assert_eq!(
                parsed.chapter,
                Some(chapter),
                "chapter mismatch for {title}"
            );
        }

        for title in ["C107", "作品 C107", "C 107", "COMIC107", "C107.5"] {
            let parsed = parse_title(title);
            assert_eq!(parsed.title, title);
            assert_eq!(parsed.chapter, None, "bare C marker parsed for {title}");
        }

        let prose = parse_title(
            "[预本个人汉化] (C102) [天气轮 (甘露アメ)] イチャらぶセックスで100回イかないと出られない部屋",
        );
        assert_eq!(prose.chapter, None);
    }

    #[test]
    fn scans_image_folders_without_decoding_every_page() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("示例漫画 第01话");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("001.jpg"), b"not a real jpeg").unwrap();
        fs::write(root.join("002.png"), b"not a real png either").unwrap();

        let book = scan_candidate(7, &root).unwrap();

        assert_eq!(book.title, "示例漫画 第01话");
        assert_eq!(book.chapter, Some(1.0));
        assert_eq!(book.format, "folder");
        assert_eq!(book.page_count, 2);
        assert_eq!(book.file_size, 36);
        assert!(book.pages.iter().all(|page| page.width.is_none()));
    }

    #[test]
    fn folder_checksums_match_copied_image_sets() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("作者A").join("示例漫画");
        let second = temp.path().join("作者B").join("示例漫画副本");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("001.webp"), b"same-size-a").unwrap();
        fs::write(first.join("002.webp"), b"same-size-bb").unwrap();
        fs::write(second.join("001.webp"), b"same-size-a").unwrap();
        fs::write(second.join("002.webp"), b"same-size-bb").unwrap();

        let first_book = scan_candidate(1, &first).unwrap();
        let second_book = scan_candidate(1, &second).unwrap();

        assert_eq!(first_book.checksum, second_book.checksum);

        fs::write(second.join("002.webp"), b"same-size-cc").unwrap();
        let changed_book = scan_candidate(1, &second).unwrap();
        assert_ne!(first_book.checksum, changed_book.checksum);
    }

    #[test]
    fn folder_checksums_detect_same_sized_nested_page_replacements() {
        let temp = tempfile::tempdir().unwrap();
        let work = temp.path().join("Artist").join("Sample Work");
        let chapter = work.join("original").join("Chapter 1");
        fs::create_dir_all(&chapter).unwrap();
        let page = chapter.join("0001.webp");
        fs::write(&page, b"original-page-a").unwrap();

        let first = scan_candidate(1, &work).unwrap();
        fs::write(&page, b"original-page-b").unwrap();
        let replaced = scan_candidate(1, &work).unwrap();

        assert_eq!(first.file_size, replaced.file_size);
        assert_eq!(first.page_count, replaced.page_count);
        assert_ne!(first.checksum, replaced.checksum);
    }

    #[test]
    fn folder_fingerprint_sampling_stays_bounded_for_large_page_sets() {
        assert_eq!(folder_fingerprint_segment_bytes(1), 256);
        assert_eq!(folder_fingerprint_segment_bytes(100), 256);
        assert_eq!(folder_fingerprint_segment_bytes(1_000), 43);
        assert_eq!(folder_fingerprint_segment_bytes(100_000), 1);
    }

    #[test]
    fn quick_checksum_samples_large_files() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first.cbz");
        let second = temp.path().join("second.cbz");
        let size = (QUICK_CHECKSUM_SAMPLE_BYTES * 4) as usize;
        let mut bytes = vec![b'a'; size];
        fs::write(&first, &bytes).unwrap();
        bytes[0] = b'b';
        fs::write(&second, &bytes).unwrap();

        assert_ne!(
            quick_checksum(&first).unwrap(),
            quick_checksum(&second).unwrap()
        );

        let third = temp.path().join("third.cbz");
        let mut file = fs::File::create(&third).unwrap();
        file.write_all(&vec![b'a'; size]).unwrap();
        file.write_all(b"tail").unwrap();
        assert_ne!(
            quick_checksum(&first).unwrap(),
            quick_checksum(&third).unwrap()
        );
    }

    #[test]
    fn discovers_versioned_chapter_folders_as_one_book() {
        let temp = tempfile::tempdir().unwrap();
        let work = temp.path().join("作者").join("[组] 示例作品 [中国翻译]");
        let chapter = work.join("original").join("第1话");
        fs::create_dir_all(&chapter).unwrap();
        fs::write(chapter.join("0001.webp"), b"page").unwrap();

        let cancel = AtomicBool::new(false);
        let discovered = discover(temp.path(), true, &cancel);

        assert_eq!(discovered, vec![work]);
    }

    #[test]
    fn reports_discovery_progress_for_archive_and_folder_candidates() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("first.cbz");
        let folder = temp.path().join("second");
        fs::write(&archive, b"not a real archive").unwrap();
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("001.jpg"), b"page").unwrap();

        let cancel = AtomicBool::new(false);
        let mut progress = Vec::new();
        let discovered =
            discover_with_progress(temp.path(), true, &cancel, |count| progress.push(count));

        assert_eq!(discovered.len(), 2);
        assert!(progress.contains(&1));
        assert!(progress.contains(&2));
    }

    #[test]
    fn non_recursive_discovery_keeps_direct_image_folders_without_deeper_archives() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("direct.cbz");
        let image_book = temp.path().join("direct-image-book");
        let deeper = temp.path().join("nested").join("deeper");
        fs::write(&archive, b"archive").unwrap();
        fs::create_dir_all(&image_book).unwrap();
        fs::write(image_book.join("001.webp"), b"image").unwrap();
        fs::create_dir_all(&deeper).unwrap();
        fs::write(deeper.join("nested.cbz"), b"archive").unwrap();
        fs::write(deeper.join("001.webp"), b"image").unwrap();

        let cancel = AtomicBool::new(false);
        let discovered = discover(temp.path(), false, &cancel);

        assert_eq!(discovered, vec![image_book, archive]);
    }

    #[test]
    fn cancels_directory_discovery_before_enumerating_every_candidate() {
        let temp = tempfile::tempdir().unwrap();
        for index in 0..24 {
            fs::write(
                temp.path().join(format!("candidate-{index}.cbz")),
                b"archive",
            )
            .unwrap();
        }
        let checks = AtomicUsize::new(0);

        let discovery = discover_with_progress_with_cancel(
            temp.path(),
            true,
            &|| checks.fetch_add(1, Ordering::Relaxed) >= 5,
            |_| {},
        );

        assert!(discovery.cancelled);
        assert!(discovery.candidates.len() < 24);
    }

    #[test]
    #[ignore = "set MANGAVAULT_SCAN_BENCHMARK_ROOT to run against a real local library"]
    fn benchmarks_real_library_discovery() {
        let root = std::env::var_os("MANGAVAULT_SCAN_BENCHMARK_ROOT")
            .map(PathBuf::from)
            .expect("MANGAVAULT_SCAN_BENCHMARK_ROOT must be set");
        let cancel = AtomicBool::new(false);
        let started = std::time::Instant::now();
        let candidates = discover(&root, true, &cancel);

        eprintln!(
            "real discovery: {} candidates in {:?}",
            candidates.len(),
            started.elapsed()
        );
        assert!(!candidates.is_empty());
    }

    #[test]
    fn scans_versioned_chapters_as_one_book_and_prefers_upscaled_pages() {
        let temp = tempfile::tempdir().unwrap();
        let work = temp
            .path()
            .join("作者")
            .join("[组] 示例作品 第02卷 [中国翻译]");
        let original_chapter = work.join("original").join("第1话");
        let upscaled_first = work.join("upscaled").join("第1话");
        let upscaled_second = work.join("upscaled").join("第2话");
        let upscaled_tenth = work.join("upscaled").join("第10话");
        fs::create_dir_all(&original_chapter).unwrap();
        fs::create_dir_all(&upscaled_first).unwrap();
        fs::create_dir_all(&upscaled_second).unwrap();
        fs::create_dir_all(&upscaled_tenth).unwrap();
        fs::write(original_chapter.join("0001.webp"), b"original").unwrap();
        fs::write(upscaled_first.join("0001.webp"), b"upscaled-a").unwrap();
        fs::write(upscaled_second.join("0001.webp"), b"upscaled-b").unwrap();
        fs::write(upscaled_tenth.join("0001.webp"), b"upscaled-c").unwrap();

        let book = scan_candidate(3, &work).unwrap();

        assert_eq!(book.title, "[组] 示例作品 第02卷 [中国翻译]");
        assert_eq!(book.author.as_deref(), Some("作者"));
        assert_eq!(book.volume, Some(2.0));
        assert_eq!(book.page_count, 3);
        assert_eq!(book.file_size, 30);
        assert_eq!(book.pages[0].source_path, "upscaled/第1话/0001.webp");
        assert_eq!(book.pages[1].source_path, "upscaled/第2话/0001.webp");
        assert_eq!(book.pages[2].source_path, "upscaled/第10话/0001.webp");
    }

    #[test]
    fn discovers_sample_library_waifu2x_layout_as_one_book_and_prefers_it() {
        let temp = tempfile::tempdir().unwrap();
        let work = temp.path().join("JK君").join("[JK君] 八年育成计划-饲料");
        let original = work.join("original").join("第1话");
        let waifu2x = work.join("waifu2x").join("第1话");
        fs::create_dir_all(&original).unwrap();
        fs::create_dir_all(&waifu2x).unwrap();
        fs::write(original.join("0001.webp"), b"original").unwrap();
        fs::write(original.join("0002.webp"), b"original-2").unwrap();
        fs::write(original.join("0003.webp"), b"original-3").unwrap();
        fs::write(waifu2x.join("0001.webp"), b"waifu2x-a").unwrap();
        fs::write(waifu2x.join("0002.webp"), b"waifu2x-b").unwrap();

        let cancel = AtomicBool::new(false);
        let discovered = discover(temp.path(), true, &cancel);
        let book = scan_candidate(3, &work).unwrap();

        assert_eq!(discovered, vec![work]);
        assert_eq!(book.author.as_deref(), Some("JK君"));
        assert_eq!(book.page_count, 3);
        assert!(book.pages[0].source_path.starts_with("waifu2x/"));
        assert!(book.pages[1].source_path.starts_with("waifu2x/"));
        assert!(book.pages[2].source_path.starts_with("original/"));
    }

    #[test]
    fn ranks_known_super_resolution_provider_directories_above_originals() {
        for provider in [
            "waifu2x",
            "Real-ESRGAN",
            "realesrgan-x4plus",
            "RealCUGAN",
            "Anime4K",
            "SwinIR",
            "Upscayl",
        ] {
            assert!(version_rank_name(provider) > version_rank_name("original"));
        }
    }

    #[test]
    fn ignores_placeholder_author_folders_for_versioned_books() {
        let temp = tempfile::tempdir().unwrap();
        let work = temp.path().join("default").join("[组] 示例作品 [中国翻译]");
        let chapter = work.join("original").join("第1话");
        fs::create_dir_all(&chapter).unwrap();
        fs::write(chapter.join("0001.webp"), b"page").unwrap();

        let book = scan_candidate(3, &work).unwrap();

        assert_eq!(book.author.as_deref(), Some("组"));
    }
}
