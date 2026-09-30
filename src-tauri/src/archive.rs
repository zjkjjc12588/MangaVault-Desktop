use std::env;
use std::ffi::OsString;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use image::ImageReader;
use serde::Serialize;
use zip::ZipArchive;

use crate::error::{MangaVaultError, Result};
use crate::process::background_command;

pub const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "avif"];
pub const BOOK_EXTENSIONS: &[&str] = &["cbz", "zip", "cbr", "rar", "7z", "pdf"];
const PDF_RENDER_DPI: &str = "160";
static FORMAT_CAPABILITIES: OnceLock<Vec<FormatCapability>> = OnceLock::new();
static SEVEN_ZIP_TOOL: OnceLock<Option<String>> = OnceLock::new();
static PDF_RENDERER_TOOL: OnceLock<Option<String>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArchiveLimits {
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
    pub max_entries: usize,
    pub max_compression_ratio: u64,
    pub max_image_pixels: u64,
    pub command_timeout: Duration,
    pub max_command_output_bytes: u64,
}

impl Default for ArchiveLimits {
    fn default() -> Self {
        Self {
            max_entry_bytes: 50 * 1024 * 1024,
            max_total_bytes: 512 * 1024 * 1024,
            max_entries: 10_000,
            max_compression_ratio: 200,
            max_image_pixels: 100_000_000,
            command_timeout: Duration::from_secs(30),
            max_command_output_bytes: 8 * 1024 * 1024,
        }
    }
}

impl ArchiveLimits {
    pub fn sanitized(self) -> Self {
        let defaults = Self::default();
        Self {
            max_entry_bytes: self
                .max_entry_bytes
                .clamp(1024 * 1024, defaults.max_entry_bytes),
            max_total_bytes: self
                .max_total_bytes
                .clamp(self.max_entry_bytes, 2 * 1024 * 1024 * 1024),
            max_entries: self.max_entries.clamp(1, 100_000),
            max_compression_ratio: self.max_compression_ratio.clamp(1, 10_000),
            max_image_pixels: self.max_image_pixels.clamp(1_000_000, 250_000_000),
            command_timeout: self
                .command_timeout
                .clamp(Duration::from_secs(3), Duration::from_secs(120)),
            max_command_output_bytes: self
                .max_command_output_bytes
                .clamp(64 * 1024, 32 * 1024 * 1024),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FormatCapability {
    pub format: String,
    pub available: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct ArchiveEntry {
    pub path: String,
    pub byte_size: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct DecodedImageInfo {
    pub width: i64,
    pub height: i64,
}

pub fn extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())
}

pub fn is_image(path: &Path) -> bool {
    extension_lower(path)
        .as_deref()
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

pub fn is_book_file(path: &Path) -> bool {
    extension_lower(path)
        .as_deref()
        .map(|ext| BOOK_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

pub fn list_archive_pages(path: &Path) -> Result<Vec<ArchiveEntry>> {
    list_archive_pages_with_limits(path, ArchiveLimits::default())
}

pub fn list_archive_pages_with_limits(
    path: &Path,
    limits: ArchiveLimits,
) -> Result<Vec<ArchiveEntry>> {
    let limits = limits.sanitized();
    match extension_lower(path).as_deref() {
        Some("cbz") | Some("zip") => list_zip_pages_with_limits(path, limits),
        Some("pdf") => list_pdf_pages_with_limits(path, limits),
        Some("cbr") | Some("rar") | Some("7z") => {
            list_external_archive_pages_with_limits(path, limits)
        }
        Some(ext) => Err(MangaVaultError::UnsupportedFormat(ext.to_string())),
        None => Err(MangaVaultError::InvalidPath),
    }
}

pub fn list_zip_pages(path: &Path) -> Result<Vec<ArchiveEntry>> {
    list_zip_pages_with_limits(path, ArchiveLimits::default())
}

pub fn list_zip_pages_with_limits(path: &Path, limits: ArchiveLimits) -> Result<Vec<ArchiveEntry>> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut entries = Vec::new();
    let mut total_bytes = 0_u64;
    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        let name = file.name().replace('\\', "/");
        if !file.is_file() || !is_image(Path::new(&name)) {
            continue;
        }
        push_limited_entry(
            &mut entries,
            &mut total_bytes,
            ArchiveEntry {
                path: name,
                byte_size: Some(file.size() as i64),
            },
            Some(file.compressed_size()),
            limits,
        )?;
    }
    sort_natural(&mut entries);
    Ok(entries)
}

pub fn list_pdf_pages(path: &Path) -> Result<Vec<ArchiveEntry>> {
    list_pdf_pages_with_limits(path, ArchiveLimits::default())
}

pub fn list_pdf_pages_with_limits(path: &Path, limits: ArchiveLimits) -> Result<Vec<ArchiveEntry>> {
    let document = lopdf::Document::load(path)?;
    let count = document.get_pages().len();
    if count > limits.max_entries {
        return Err(MangaVaultError::Message(format!(
            "PDF page count exceeds archive entry limit: {count} > {}",
            limits.max_entries
        )));
    }
    Ok((0..count)
        .map(|index| ArchiveEntry {
            path: format!("pdf-page:{}", index + 1),
            byte_size: None,
        })
        .collect())
}

pub fn list_external_archive_pages(path: &Path) -> Result<Vec<ArchiveEntry>> {
    list_external_archive_pages_with_limits(path, ArchiveLimits::default())
}

pub fn list_external_archive_pages_with_limits(
    path: &Path,
    limits: ArchiveLimits,
) -> Result<Vec<ArchiveEntry>> {
    let tool = find_7z()
        .ok_or_else(|| MangaVaultError::ExtractorUnavailable(path.to_string_lossy().to_string()))?;
    let mut command = background_command(tool);
    command.args(external_archive_list_args(path));
    let output = run_limited_command(
        &mut command,
        limits.max_command_output_bytes,
        limits.command_timeout,
    )?;
    if !output.status.success() {
        return Err(MangaVaultError::Message(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }
    parse_external_archive_listing(&String::from_utf8_lossy(&output.stdout), limits)
}

fn parse_external_archive_listing(
    stdout: &str,
    limits: ArchiveLimits,
) -> Result<Vec<ArchiveEntry>> {
    let mut entries = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_size: Option<i64> = None;
    let mut current_packed_size: Option<u64> = None;
    let mut total_bytes = 0_u64;
    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("Path = ") {
            current_path = Some(value.replace('\\', "/"));
            current_size = None;
            current_packed_size = None;
        } else if let Some(value) = line.strip_prefix("Size = ") {
            current_size = value.parse::<i64>().ok();
        } else if let Some(value) = line.strip_prefix("Packed Size = ") {
            current_packed_size = value.parse::<u64>().ok();
        } else if line.is_empty() {
            if let Some(name) = current_path.take() {
                if is_image(Path::new(&name)) {
                    push_limited_entry(
                        &mut entries,
                        &mut total_bytes,
                        ArchiveEntry {
                            path: name,
                            byte_size: current_size,
                        },
                        current_packed_size,
                        limits,
                    )?;
                }
            }
        }
    }
    if let Some(name) = current_path.take() {
        if is_image(Path::new(&name)) {
            push_limited_entry(
                &mut entries,
                &mut total_bytes,
                ArchiveEntry {
                    path: name,
                    byte_size: current_size,
                },
                current_packed_size,
                limits,
            )?;
        }
    }
    sort_natural(&mut entries);
    Ok(entries)
}

pub fn read_page_bytes(book_path: &Path, source_path: &str) -> Result<Vec<u8>> {
    read_page_bytes_with_limits(book_path, source_path, ArchiveLimits::default())
}

pub fn read_page_bytes_with_limits(
    book_path: &Path,
    source_path: &str,
    limits: ArchiveLimits,
) -> Result<Vec<u8>> {
    let limits = limits.sanitized();
    if book_path.is_dir() {
        let full = safe_join(book_path, Path::new(source_path))?;
        return read_file_with_limit(&full, limits.max_entry_bytes);
    }
    match extension_lower(book_path).as_deref() {
        Some("cbz") | Some("zip") => read_zip_entry(book_path, source_path, limits),
        Some("cbr") | Some("rar") | Some("7z") => {
            read_external_entry(book_path, source_path, limits)
        }
        Some("pdf") => render_pdf_page(book_path, source_path, limits),
        Some(ext) => Err(MangaVaultError::UnsupportedFormat(ext.to_string())),
        None => Err(MangaVaultError::InvalidPath),
    }
}

pub fn page_data_url(book_path: &Path, source_path: &str) -> Result<(String, String)> {
    let bytes = read_page_bytes(book_path, source_path)?;
    let mime = page_mime_type(source_path);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok((mime.to_string(), format!("data:{mime};base64,{encoded}")))
}

pub fn format_capabilities() -> Vec<FormatCapability> {
    cached_value(&FORMAT_CAPABILITIES, detect_format_capabilities)
}

fn detect_format_capabilities() -> Vec<FormatCapability> {
    let extractor = find_7z();
    let pdf_renderer = find_pdf_renderer();
    vec![
        FormatCapability {
            format: "folder".to_string(),
            available: true,
            detail: "JPG, PNG, WEBP, AVIF".to_string(),
        },
        FormatCapability {
            format: "cbz".to_string(),
            available: true,
            detail: "native ZIP reader".to_string(),
        },
        FormatCapability {
            format: "zip".to_string(),
            available: true,
            detail: "native ZIP reader".to_string(),
        },
        FormatCapability {
            format: "cbr/rar/7z".to_string(),
            available: extractor.is_some(),
            detail: extractor.unwrap_or_else(|| "requires 7z, 7zz, or 7za".to_string()),
        },
        FormatCapability {
            format: "pdf".to_string(),
            available: pdf_renderer.is_some(),
            detail: pdf_renderer
                .unwrap_or_else(|| "requires pdftoppm or mutool for reading".to_string()),
        },
    ]
}

pub fn page_mime_type(source_path: &str) -> &'static str {
    if source_path.starts_with("pdf-page:") {
        "image/png"
    } else {
        mime_from_path(Path::new(source_path))
    }
}

pub fn image_dimensions_from_path(path: &Path) -> Result<Option<DecodedImageInfo>> {
    let reader = ImageReader::open(path)?;
    let dimensions = reader.into_dimensions()?;
    Ok(Some(DecodedImageInfo {
        width: dimensions.0 as i64,
        height: dimensions.1 as i64,
    }))
}

pub fn image_dimensions_from_bytes(bytes: &[u8]) -> Result<Option<DecodedImageInfo>> {
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let dimensions = reader.into_dimensions()?;
    Ok(Some(DecodedImageInfo {
        width: dimensions.0 as i64,
        height: dimensions.1 as i64,
    }))
}

pub fn validate_image_bytes(bytes: &[u8], limits: ArchiveLimits) -> Result<()> {
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let (width, height) = reader.into_dimensions()?;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if pixels > limits.sanitized().max_image_pixels {
        return Err(MangaVaultError::Message(format!(
            "image pixel count exceeds limit: {pixels}"
        )));
    }
    Ok(())
}

fn read_zip_entry(path: &Path, source_path: &str, limits: ArchiveLimits) -> Result<Vec<u8>> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut entry = archive.by_name(source_path)?;
    if entry.size() > limits.max_entry_bytes {
        return Err(MangaVaultError::Message(format!(
            "entry exceeds extraction limit: {source_path}"
        )));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn read_external_entry(path: &Path, source_path: &str, limits: ArchiveLimits) -> Result<Vec<u8>> {
    let tool = find_7z()
        .ok_or_else(|| MangaVaultError::ExtractorUnavailable(path.to_string_lossy().to_string()))?;
    let mut command = background_command(tool);
    command.args(external_archive_read_args(path, source_path));
    let output = run_limited_command(&mut command, limits.max_entry_bytes, limits.command_timeout)?;
    if !output.status.success() {
        return Err(MangaVaultError::Message(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }
    Ok(output.stdout)
}

fn render_pdf_page(path: &Path, source_path: &str, limits: ArchiveLimits) -> Result<Vec<u8>> {
    let page = parse_pdf_page_number(source_path)?;
    let work_dir = std::env::temp_dir().join(format!(
        "mangavault-pdf-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default()
    ));
    std::fs::create_dir_all(&work_dir)?;
    let result = if let Some(tool) = find_pdf_renderer() {
        let tool_name = Path::new(&tool)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if tool_name.eq_ignore_ascii_case("pdftoppm") {
            let prefix = work_dir.join("page");
            let mut command = background_command(tool);
            command
                .arg("-f")
                .arg(page.to_string())
                .arg("-l")
                .arg(page.to_string())
                .arg("-singlefile")
                .arg("-png")
                .arg("-r")
                .arg(PDF_RENDER_DPI)
                .arg(path)
                .arg(&prefix);
            let output = run_limited_command(
                &mut command,
                limits.max_command_output_bytes,
                limits.command_timeout,
            )?;
            if output.status.success() {
                read_rendered_png(prefix.with_extension("png"), limits)
            } else {
                Err(MangaVaultError::Message(
                    String::from_utf8_lossy(&output.stderr).to_string(),
                ))
            }
        } else {
            let output_path = work_dir.join("page.png");
            let mut command = background_command(tool);
            command
                .arg("draw")
                .arg("-o")
                .arg(&output_path)
                .arg("-r")
                .arg(PDF_RENDER_DPI)
                .arg(path)
                .arg(page.to_string());
            let output = run_limited_command(
                &mut command,
                limits.max_command_output_bytes,
                limits.command_timeout,
            )?;
            if output.status.success() {
                read_rendered_png(output_path, limits)
            } else {
                Err(MangaVaultError::Message(
                    String::from_utf8_lossy(&output.stderr).to_string(),
                ))
            }
        }
    } else {
        Err(MangaVaultError::ExtractorUnavailable(
            "pdftoppm or mutool".to_string(),
        ))
    };
    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

fn read_rendered_png(path: PathBuf, limits: ArchiveLimits) -> Result<Vec<u8>> {
    let metadata = std::fs::metadata(&path)?;
    if metadata.len() > limits.max_entry_bytes {
        return Err(MangaVaultError::Message(
            "rendered PDF page exceeds extraction limit".to_string(),
        ));
    }
    read_file_with_limit(&path, limits.max_entry_bytes)
}

fn external_archive_list_args(path: &Path) -> Vec<OsString> {
    vec![
        OsString::from("l"),
        OsString::from("-slt"),
        OsString::from("--"),
        path.as_os_str().to_os_string(),
    ]
}

fn external_archive_read_args(path: &Path, source_path: &str) -> Vec<OsString> {
    vec![
        OsString::from("x"),
        OsString::from("-so"),
        OsString::from("--"),
        path.as_os_str().to_os_string(),
        OsString::from(source_path),
    ]
}

fn parse_pdf_page_number(source_path: &str) -> Result<usize> {
    let raw = source_path
        .strip_prefix("pdf-page:")
        .ok_or(MangaVaultError::InvalidPath)?;
    let page = raw
        .parse::<usize>()
        .map_err(|_| MangaVaultError::InvalidPath)?;
    if page == 0 {
        return Err(MangaVaultError::InvalidPath);
    }
    Ok(page)
}

fn safe_join(base: &Path, relative: &Path) -> Result<PathBuf> {
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(MangaVaultError::InvalidPath);
    }
    let canonical_base = base.canonicalize()?;
    let candidate = canonical_base.join(relative).canonicalize()?;
    if !candidate.starts_with(&canonical_base) {
        return Err(MangaVaultError::InvalidPath);
    }
    Ok(candidate)
}

fn push_limited_entry(
    entries: &mut Vec<ArchiveEntry>,
    total_bytes: &mut u64,
    entry: ArchiveEntry,
    compressed_size: Option<u64>,
    limits: ArchiveLimits,
) -> Result<()> {
    let size = entry.byte_size.unwrap_or_default().max(0) as u64;
    if size > limits.max_entry_bytes {
        return Err(MangaVaultError::Message(format!(
            "archive entry exceeds extraction limit: {}",
            entry.path
        )));
    }
    if let Some(compressed) = compressed_size.filter(|size| *size > 0) {
        if size / compressed.max(1) > limits.max_compression_ratio {
            return Err(MangaVaultError::Message(format!(
                "archive entry compression ratio exceeds limit: {}",
                entry.path
            )));
        }
    }
    if entries.len() >= limits.max_entries {
        return Err(MangaVaultError::Message(
            "archive entry count exceeds limit".to_string(),
        ));
    }
    *total_bytes = total_bytes.saturating_add(size);
    if *total_bytes > limits.max_total_bytes {
        return Err(MangaVaultError::Message(
            "archive total extraction size exceeds limit".to_string(),
        ));
    }
    entries.push(entry);
    Ok(())
}

fn read_file_with_limit(path: &Path, max_bytes: u64) -> Result<Vec<u8>> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > max_bytes {
        return Err(MangaVaultError::Message(format!(
            "entry exceeds extraction limit: {}",
            path.to_string_lossy()
        )));
    }
    std::fs::read(path).map_err(Into::into)
}

struct LimitedCommandOutput {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_limited_command(
    command: &mut Command,
    max_output_bytes: u64,
    timeout: Duration,
) -> Result<LimitedCommandOutput> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| MangaVaultError::Message("failed to capture command stdout".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| MangaVaultError::Message("failed to capture command stderr".to_string()))?;
    let stdout_reader = thread::spawn(move || read_limited_stream(stdout, max_output_bytes));
    let stderr_reader = thread::spawn(move || read_limited_stream(stderr, max_output_bytes));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(MangaVaultError::Message(
                "external command timed out".to_string(),
            ));
        }
        thread::sleep(Duration::from_millis(10));
    };
    let (stdout, stdout_overflow) = stdout_reader
        .join()
        .map_err(|_| MangaVaultError::Message("stdout reader panicked".to_string()))??;
    let (stderr, stderr_overflow) = stderr_reader
        .join()
        .map_err(|_| MangaVaultError::Message("stderr reader panicked".to_string()))??;
    if stdout_overflow || stderr_overflow {
        return Err(MangaVaultError::Message(
            "external command output exceeds limit".to_string(),
        ));
    }
    Ok(LimitedCommandOutput {
        status,
        stdout,
        stderr,
    })
}

fn read_limited_stream(mut stream: impl Read, limit: u64) -> Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::new();
    let mut overflow = false;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(bytes.len() as u64) as usize;
        let kept = remaining.min(read);
        bytes.extend_from_slice(&buffer[..kept]);
        if kept < read {
            overflow = true;
        }
    }
    Ok((bytes, overflow))
}

fn find_7z() -> Option<String> {
    cached_value(&SEVEN_ZIP_TOOL, || resolve_tool(&["7zz", "7z", "7za"]))
}

fn find_pdf_renderer() -> Option<String> {
    cached_value(&PDF_RENDERER_TOOL, || resolve_tool(&["pdftoppm", "mutool"]))
}

fn cached_value<T: Clone>(cache: &OnceLock<T>, detector: impl FnOnce() -> T) -> T {
    cache.get_or_init(detector).clone()
}

fn resolve_tool(names: &[&str]) -> Option<String> {
    let bundled_root = env::var_os("MANGAVAULT_BUNDLED_TOOLS_DIR").map(PathBuf::from);
    let search_path = env::var_os("PATH");
    resolve_tool_from(
        names,
        bundled_root.as_deref(),
        search_path.as_deref(),
        cfg!(windows),
    )
}

fn resolve_tool_from(
    names: &[&str],
    bundled_root: Option<&Path>,
    search_path: Option<&std::ffi::OsStr>,
    windows: bool,
) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(root) = bundled_root {
        for executable in tool_file_names(names, windows) {
            for directory in [
                root.to_path_buf(),
                root.join("7zip"),
                root.join("poppler").join("bin"),
            ] {
                candidates.push(directory.join(&executable));
            }
        }
    }
    if let Some(value) = search_path {
        let file_names = tool_file_names(names, windows);
        for directory in env::split_paths(value) {
            for executable in &file_names {
                candidates.push(directory.join(executable));
            }
        }
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| candidate.canonicalize().ok())
        .map(|path| path.to_string_lossy().to_string())
}

fn tool_file_names(names: &[&str], windows: bool) -> Vec<OsString> {
    names
        .iter()
        .flat_map(|name| {
            if windows && Path::new(name).extension().is_none() {
                vec![OsString::from(format!("{name}.exe")), OsString::from(name)]
            } else {
                vec![OsString::from(name)]
            }
        })
        .collect()
}

fn mime_from_path(path: &Path) -> &'static str {
    match extension_lower(path).as_deref() {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}

fn sort_natural(entries: &mut [ArchiveEntry]) {
    entries.sort_by_key(|entry| nat_key(&entry.path));
}

fn nat_key(value: &str) -> Vec<String> {
    let mut key = Vec::new();
    let mut current = String::new();
    let mut digit = false;
    for ch in value.chars() {
        if ch.is_ascii_digit() != digit && !current.is_empty() {
            key.push(normalize_piece(&current, digit));
            current.clear();
        }
        digit = ch.is_ascii_digit();
        current.push(ch);
    }
    if !current.is_empty() {
        key.push(normalize_piece(&current, digit));
    }
    key
}

fn normalize_piece(value: &str, digit: bool) -> String {
    if digit {
        format!("{:0>12}", value)
    } else {
        value.to_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use zip::write::SimpleFileOptions;

    #[test]
    fn capability_cache_is_single_flight_across_concurrent_callers() {
        let cache = Arc::new(OnceLock::new());
        let detections = Arc::new(AtomicUsize::new(0));
        let callers = (0..20)
            .map(|_| {
                let cache = Arc::clone(&cache);
                let detections = Arc::clone(&detections);
                std::thread::spawn(move || {
                    cached_value(&cache, || {
                        detections.fetch_add(1, Ordering::SeqCst);
                        vec!["7z.exe".to_string(), "pdftoppm.exe".to_string()]
                    })
                })
            })
            .collect::<Vec<_>>();

        for caller in callers {
            assert_eq!(caller.join().unwrap().len(), 2);
        }
        assert_eq!(detections.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn resolves_bundled_windows_executables_without_shell_wrappers() {
        let temp = tempfile::tempdir().unwrap();
        let tools = temp.path();
        let seven_zip_dir = tools.join("7zip");
        std::fs::create_dir(&seven_zip_dir).unwrap();
        let executable = seven_zip_dir.join("7z.exe");
        std::fs::write(&executable, b"fixture").unwrap();
        std::fs::write(seven_zip_dir.join("7zz.cmd"), b"fixture").unwrap();

        let resolved = resolve_tool_from(&["7zz", "7z", "7za"], Some(tools), None, true)
            .expect("bundled executable should resolve");

        assert_eq!(PathBuf::from(resolved), executable.canonicalize().unwrap());
    }

    #[test]
    fn ignores_windows_cmd_and_bat_tool_wrappers() {
        let temp = tempfile::tempdir().unwrap();
        let tools = temp.path();
        std::fs::create_dir(tools.join("7zip")).unwrap();
        std::fs::write(tools.join("7zip").join("7z.cmd"), b"fixture").unwrap();
        std::fs::write(tools.join("7zip").join("7za.bat"), b"fixture").unwrap();

        assert!(resolve_tool_from(&["7z", "7za"], Some(tools), None, true).is_none());
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(safe_join(Path::new("/tmp/base"), Path::new("../secret")).is_err());
    }

    #[test]
    fn rejects_folder_pages_that_escape_through_a_symbolic_link() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("book");
        let outside = dir.path().join("outside.webp");
        std::fs::create_dir(&base).unwrap();
        std::fs::write(&outside, b"not an image").unwrap();
        let link = base.join("escaped.webp");

        if create_file_link(&outside, &link).is_err() {
            return;
        }

        assert!(safe_join(&base, Path::new("escaped.webp")).is_err());
    }

    #[test]
    fn external_archive_arguments_stop_switch_parsing_for_untrusted_names() {
        let archive = Path::new("C:/library/-malicious.7z");
        let list_args = external_archive_list_args(archive);
        let read_args = external_archive_read_args(archive, "-oC:/outside/page.webp");

        assert_eq!(
            list_args,
            vec![
                OsString::from("l"),
                OsString::from("-slt"),
                OsString::from("--"),
                OsString::from("C:/library/-malicious.7z"),
            ]
        );
        assert_eq!(
            read_args,
            vec![
                OsString::from("x"),
                OsString::from("-so"),
                OsString::from("--"),
                OsString::from("C:/library/-malicious.7z"),
                OsString::from("-oC:/outside/page.webp"),
            ]
        );
    }

    #[test]
    fn rejects_external_archive_entries_with_excessive_compression_ratio() {
        let listing = "Path = pages/001.webp\nSize = 10485760\nPacked Size = 1\n\n";
        let limits = ArchiveLimits {
            max_compression_ratio: 100,
            ..ArchiveLimits::default()
        };

        assert!(parse_external_archive_listing(listing, limits).is_err());
    }

    #[cfg(unix)]
    fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(target, link)
    }

    #[test]
    fn identifies_supported_images() {
        assert!(is_image(Path::new("page.webp")));
        assert!(!is_image(Path::new("notes.txt")));
    }

    #[test]
    fn parses_pdf_page_sources() {
        assert_eq!(parse_pdf_page_number("pdf-page:12").unwrap(), 12);
        assert!(parse_pdf_page_number("pdf-page:0").is_err());
        assert!(parse_pdf_page_number("../page.png").is_err());
    }

    #[test]
    fn rejects_archives_exceeding_entry_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("two-pages.cbz");
        let file = File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("001.jpg", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"one").unwrap();
        writer
            .start_file("002.jpg", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"two").unwrap();
        writer.finish().unwrap();

        let limits = ArchiveLimits {
            max_entries: 1,
            ..ArchiveLimits::default()
        };
        assert!(list_archive_pages_with_limits(&path, limits).is_err());
    }
}
