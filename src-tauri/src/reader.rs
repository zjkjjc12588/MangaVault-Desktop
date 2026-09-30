use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};

use crate::archive::{
    page_mime_type, read_page_bytes_with_limits, validate_image_bytes, ArchiveLimits,
};
use crate::error::Result;
use crate::models::PagePayload;

#[derive(Debug, Clone)]
pub struct ThumbnailWrite {
    pub disk_path: PathBuf,
    pub width: i64,
    pub height: i64,
    pub byte_size: i64,
}

#[derive(Debug, Clone)]
pub struct ThumbnailPayload {
    pub payload: PagePayload,
    pub write: Option<ThumbnailWrite>,
}

#[derive(Debug, Clone)]
pub struct MaterializedPage {
    pub payload: PagePayload,
    pub wrote: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PageTransforms {
    pub trim_white: bool,
    pub sharpen: bool,
}

impl PageTransforms {
    fn requires_processing(self) -> bool {
        self.trim_white || self.sharpen
    }
}

#[cfg(test)]
pub fn page_cache_key(book_path: &str, book_updated_at: &str, page_index: i64) -> String {
    blake3::hash(format!("{book_path}:{book_updated_at}:{page_index}").as_bytes())
        .to_hex()
        .to_string()
}

pub fn page_cache_key_for_source(
    book_path: &str,
    book_updated_at: &str,
    page_index: i64,
    source_path: &str,
) -> String {
    blake3::hash(format!("{book_path}:{book_updated_at}:{page_index}:{source_path}").as_bytes())
        .to_hex()
        .to_string()
}

pub fn page_cache_key_for_source_with_transforms(
    book_path: &str,
    book_updated_at: &str,
    page_index: i64,
    source_path: &str,
    transforms: PageTransforms,
) -> String {
    if !transforms.requires_processing() {
        return page_cache_key_for_source(book_path, book_updated_at, page_index, source_path);
    }
    blake3::hash(
        format!(
            "{book_path}:{book_updated_at}:{page_index}:{source_path}:trim={}:sharpen={}:v1",
            transforms.trim_white, transforms.sharpen
        )
        .as_bytes(),
    )
    .to_hex()
    .to_string()
}

pub fn page_source_candidates(source_path: &str, prefer_enhanced: bool) -> Vec<String> {
    let Some((version, suffix)) = source_path.split_once('/') else {
        return vec![source_path.to_string()];
    };
    if !is_enhanced_version_directory(version) {
        return vec![source_path.to_string()];
    }
    let original = format!("original/{suffix}");
    if prefer_enhanced {
        vec![source_path.to_string(), original]
    } else {
        vec![original, source_path.to_string()]
    }
}

#[cfg(test)]
pub fn materialize_page_from_source(
    cache_dir: &Path,
    book_path: &Path,
    source_path: &str,
    cache_key: &str,
    page_index: i64,
) -> Result<MaterializedPage> {
    materialize_page_from_source_with_limits(
        cache_dir,
        book_path,
        source_path,
        cache_key,
        page_index,
        ArchiveLimits::default(),
    )
}

#[cfg(test)]
pub fn materialize_page_from_source_with_limits(
    cache_dir: &Path,
    book_path: &Path,
    source_path: &str,
    cache_key: &str,
    page_index: i64,
    limits: ArchiveLimits,
) -> Result<MaterializedPage> {
    materialize_page_from_source_with_limits_and_transforms(
        cache_dir,
        book_path,
        source_path,
        cache_key,
        page_index,
        limits,
        PageTransforms::default(),
    )
}

pub fn materialize_page_from_source_with_limits_and_transforms(
    cache_dir: &Path,
    book_path: &Path,
    source_path: &str,
    cache_key: &str,
    page_index: i64,
    limits: ArchiveLimits,
    transforms: PageTransforms,
) -> Result<MaterializedPage> {
    std::fs::create_dir_all(cache_dir)?;
    let mime_type = if transforms.requires_processing() {
        "image/png"
    } else {
        page_mime_type(source_path)
    };
    let extension = extension_for_mime(mime_type);
    let disk_path = cache_dir.join(format!("{cache_key}.{extension}"));
    if disk_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 0)
    {
        touch_file(&disk_path);
        return Ok(MaterializedPage {
            payload: file_page_payload(page_index, mime_type, &disk_path),
            wrote: false,
        });
    }

    let bytes = read_page_bytes_with_limits(book_path, source_path, limits)?;
    validate_image_bytes(&bytes, limits)?;
    let materialized = if transforms.requires_processing() {
        render_page_transforms(&bytes, transforms)?
    } else {
        bytes
    };
    write_atomic(&disk_path, &materialized)?;
    Ok(MaterializedPage {
        payload: file_page_payload(page_index, mime_type, &disk_path),
        wrote: true,
    })
}

#[cfg(test)]
pub fn materialize_page_from_candidates_with_limits(
    cache_dir: &Path,
    book_path: &Path,
    source_paths: &[String],
    cache_key: &str,
    page_index: i64,
    limits: ArchiveLimits,
) -> Result<MaterializedPage> {
    materialize_page_from_candidates_with_limits_and_transforms(
        cache_dir,
        book_path,
        source_paths,
        cache_key,
        page_index,
        limits,
        PageTransforms::default(),
    )
}

pub fn materialize_page_from_candidates_with_limits_and_transforms(
    cache_dir: &Path,
    book_path: &Path,
    source_paths: &[String],
    cache_key: &str,
    page_index: i64,
    limits: ArchiveLimits,
    transforms: PageTransforms,
) -> Result<MaterializedPage> {
    let mut last_error = None;
    for source_path in source_paths {
        match materialize_page_from_source_with_limits_and_transforms(
            cache_dir,
            book_path,
            source_path,
            cache_key,
            page_index,
            limits,
            transforms,
        ) {
            Ok(page) => return Ok(page),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.expect("page source candidates must not be empty"))
}

fn render_page_transforms(bytes: &[u8], transforms: PageTransforms) -> Result<Vec<u8>> {
    let image = image::load_from_memory(bytes)?;
    let image = apply_page_transforms(image, transforms);
    let mut output = std::io::Cursor::new(Vec::new());
    image.write_to(&mut output, ImageFormat::Png)?;
    Ok(output.into_inner())
}

fn apply_page_transforms(image: DynamicImage, transforms: PageTransforms) -> DynamicImage {
    let image = if transforms.trim_white {
        trim_white_borders(image)
    } else {
        image
    };
    if transforms.sharpen {
        DynamicImage::ImageRgba8(image::imageops::unsharpen(&image.to_rgba8(), 1.1, 2))
    } else {
        image
    }
}

fn trim_white_borders(image: DynamicImage) -> DynamicImage {
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    if width < 8 || height < 8 {
        return DynamicImage::ImageRgba8(rgba);
    }
    let horizontal_step = (width / 1600).max(1);
    let vertical_step = (height / 1600).max(1);
    let blank_row = |y: u32| {
        let samples = width.div_ceil(horizontal_step);
        let allowance = (samples / 250).max(2);
        let content = (0..width)
            .step_by(horizontal_step as usize)
            .filter(|x| is_non_white_pixel(rgba.get_pixel(*x, y).0))
            .count() as u32;
        content <= allowance
    };
    let blank_column = |x: u32| {
        let samples = height.div_ceil(vertical_step);
        let allowance = (samples / 250).max(2);
        let content = (0..height)
            .step_by(vertical_step as usize)
            .filter(|y| is_non_white_pixel(rgba.get_pixel(x, *y).0))
            .count() as u32;
        content <= allowance
    };

    let left = (0..width).take_while(|x| blank_column(*x)).count() as u32;
    let right = (0..width).rev().take_while(|x| blank_column(*x)).count() as u32;
    let top = (0..height).take_while(|y| blank_row(*y)).count() as u32;
    let bottom = (0..height).rev().take_while(|y| blank_row(*y)).count() as u32;
    let crop_width = width.saturating_sub(left.saturating_add(right));
    let crop_height = height.saturating_sub(top.saturating_add(bottom));
    let has_safe_crop = crop_width >= width.saturating_mul(3) / 5
        && crop_height >= height.saturating_mul(3) / 5
        && (left > 0 || right > 0 || top > 0 || bottom > 0);
    if !has_safe_crop {
        return DynamicImage::ImageRgba8(rgba);
    }
    DynamicImage::ImageRgba8(
        image::imageops::crop_imm(&rgba, left, top, crop_width, crop_height).to_image(),
    )
}

fn is_non_white_pixel(pixel: [u8; 4]) -> bool {
    pixel[3] > 16 && (pixel[0] < 245 || pixel[1] < 245 || pixel[2] < 245)
}

#[cfg(test)]
pub fn load_thumbnail_from_source(
    cache_dir: &Path,
    book_path: &Path,
    source_path: &str,
    cache_key: &str,
    cached_path: Option<PathBuf>,
    page_index: i64,
) -> Result<ThumbnailPayload> {
    load_thumbnail_from_source_with_limits(
        cache_dir,
        book_path,
        source_path,
        cache_key,
        cached_path,
        page_index,
        ArchiveLimits::default(),
    )
}

pub fn load_thumbnail_from_source_with_limits(
    cache_dir: &Path,
    book_path: &Path,
    source_path: &str,
    cache_key: &str,
    cached_path: Option<PathBuf>,
    page_index: i64,
    limits: ArchiveLimits,
) -> Result<ThumbnailPayload> {
    if let Some(path) = cached_path {
        if path.exists() {
            return Ok(ThumbnailPayload {
                payload: file_page_payload(page_index, "image/jpeg", &path),
                write: None,
            });
        }
    }

    std::fs::create_dir_all(cache_dir)?;
    let source = read_page_bytes_with_limits(book_path, source_path, limits)?;
    validate_image_bytes(&source, limits)?;
    let image = image::load_from_memory(&source)?;
    let thumbnail = image.resize(360, 540, FilterType::Lanczos3).to_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 82).encode_image(&thumbnail)?;
    let disk_path = cache_dir.join(format!("{cache_key}.jpg"));
    std::fs::write(&disk_path, &bytes)?;
    Ok(ThumbnailPayload {
        payload: file_page_payload(page_index, "image/jpeg", &disk_path),
        write: Some(ThumbnailWrite {
            disk_path,
            width: thumbnail.width() as i64,
            height: thumbnail.height() as i64,
            byte_size: bytes.len() as i64,
        }),
    })
}

pub fn load_thumbnail_from_candidates_with_limits(
    cache_dir: &Path,
    book_path: &Path,
    source_paths: &[String],
    cache_key: &str,
    cached_path: Option<PathBuf>,
    page_index: i64,
    limits: ArchiveLimits,
) -> Result<ThumbnailPayload> {
    let mut last_error = None;
    for source_path in source_paths {
        match load_thumbnail_from_source_with_limits(
            cache_dir,
            book_path,
            source_path,
            cache_key,
            cached_path.clone(),
            page_index,
            limits,
        ) {
            Ok(payload) => return Ok(payload),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.expect("page source candidates must not be empty"))
}

fn file_page_payload(page_index: i64, mime_type: &str, path: &Path) -> PagePayload {
    PagePayload {
        page_index,
        mime_type: mime_type.to_string(),
        data_url: String::new(),
        file_path: Some(path.to_string_lossy().to_string()),
    }
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/avif" => "avif",
        _ => "png",
    }
}

fn is_enhanced_version_directory(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "waifu2x",
        "upscale",
        "upscaled",
        "real-esrgan",
        "realesrgan",
        "realcugan",
        "anime4k",
        "swinir",
        "upscayl",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let temporary = path.with_extension(format!(
        "{}.tmp-{}-{nonce}",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("page"),
        std::process::id()
    ));
    std::fs::write(&temporary, bytes)?;
    match std::fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            let _ = std::fs::remove_file(&temporary);
            Ok(())
        }
        Err(err) => {
            let _ = std::fs::remove_file(&temporary);
            Err(err.into())
        }
    }
}

fn touch_file(path: &Path) {
    let Ok(file) = std::fs::OpenOptions::new().write(true).open(path) else {
        return;
    };
    let times = std::fs::FileTimes::new().set_modified(std::time::SystemTime::now());
    let _ = file.set_times(times);
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    const PNG_1X1: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
        251, 3, 253, 167, 89, 231, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    #[test]
    fn page_cache_keys_include_book_version_and_page() {
        let first = page_cache_key("D:/Manga/Book", "2026-07-09T00:00:00Z", 0);
        let same = page_cache_key("D:/Manga/Book", "2026-07-09T00:00:00Z", 0);
        let changed_page = page_cache_key("D:/Manga/Book", "2026-07-09T00:00:00Z", 1);
        let changed_version = page_cache_key("D:/Manga/Book", "2026-07-09T00:00:01Z", 0);

        assert_eq!(first, same);
        assert_ne!(first, changed_page);
        assert_ne!(first, changed_version);
    }

    #[test]
    fn transform_cache_keys_do_not_collide_with_original_pages() {
        let original = page_cache_key_for_source_with_transforms(
            "D:/Manga/Book",
            "2026-07-09T00:00:00Z",
            0,
            "001.png",
            PageTransforms::default(),
        );
        let trimmed = page_cache_key_for_source_with_transforms(
            "D:/Manga/Book",
            "2026-07-09T00:00:00Z",
            0,
            "001.png",
            PageTransforms {
                trim_white: true,
                sharpen: false,
            },
        );
        let sharpened = page_cache_key_for_source_with_transforms(
            "D:/Manga/Book",
            "2026-07-09T00:00:00Z",
            0,
            "001.png",
            PageTransforms {
                trim_white: false,
                sharpen: true,
            },
        );

        assert_ne!(original, trimmed);
        assert_ne!(original, sharpened);
        assert_ne!(trimmed, sharpened);
    }

    #[test]
    fn trims_plain_white_borders_without_overcropping_page_content() {
        let mut page = image::RgbaImage::from_pixel(100, 120, image::Rgba([255, 255, 255, 255]));
        for y in 12..108 {
            for x in 10..90 {
                page.put_pixel(x, y, image::Rgba([20, 20, 20, 255]));
            }
        }

        let trimmed = apply_page_transforms(
            DynamicImage::ImageRgba8(page),
            PageTransforms {
                trim_white: true,
                sharpen: false,
            },
        );

        assert_eq!(trimmed.dimensions(), (80, 96));
    }

    #[test]
    fn sharpens_opted_in_pages_without_changing_dimensions() {
        let mut page = image::RgbaImage::from_pixel(20, 20, image::Rgba([128, 128, 128, 255]));
        page.put_pixel(10, 10, image::Rgba([40, 40, 40, 255]));
        let source = DynamicImage::ImageRgba8(page.clone());
        let sharpened = apply_page_transforms(
            source,
            PageTransforms {
                trim_white: false,
                sharpen: true,
            },
        );

        assert_eq!(sharpened.dimensions(), (20, 20));
        assert_ne!(sharpened.to_rgba8(), page);
    }

    #[test]
    fn falls_back_to_original_when_an_enhanced_page_is_not_decodable() {
        let dir = tempfile::tempdir().unwrap();
        let book_dir = dir.path().join("book");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(book_dir.join("waifu2x/第1话")).unwrap();
        std::fs::create_dir_all(book_dir.join("original/第1话")).unwrap();
        std::fs::write(book_dir.join("waifu2x/第1话/001.png"), b"broken").unwrap();
        std::fs::write(book_dir.join("original/第1话/001.png"), PNG_1X1).unwrap();
        let candidates = page_source_candidates("waifu2x/第1话/001.png", true);

        let page = materialize_page_from_candidates_with_limits(
            &cache_dir,
            &book_dir,
            &candidates,
            "fallback-key",
            0,
            ArchiveLimits::default(),
        )
        .unwrap();

        assert_eq!(
            std::fs::read(page.payload.file_path.unwrap()).unwrap(),
            PNG_1X1
        );
    }

    #[test]
    fn allows_the_original_version_to_be_preferred_explicitly() {
        assert_eq!(
            page_source_candidates("waifu2x/chapter/001.webp", false),
            vec![
                "original/chapter/001.webp".to_string(),
                "waifu2x/chapter/001.webp".to_string(),
            ]
        );
    }

    #[test]
    fn materializes_pages_once_and_returns_cache_file_payloads() {
        let dir = tempfile::tempdir().unwrap();
        let book_dir = dir.path().join("book");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&book_dir).unwrap();
        std::fs::write(book_dir.join("001.png"), PNG_1X1).unwrap();

        let first =
            materialize_page_from_source(&cache_dir, &book_dir, "001.png", "cache-key", 0).unwrap();
        let second =
            materialize_page_from_source(&cache_dir, &book_dir, "001.png", "cache-key", 0).unwrap();

        assert!(first.wrote);
        assert!(!second.wrote);
        assert!(first.payload.data_url.is_empty());
        assert_eq!(first.payload.file_path, second.payload.file_path);
        assert_eq!(
            std::fs::read(first.payload.file_path.unwrap()).unwrap(),
            PNG_1X1
        );
    }

    #[test]
    fn refuses_folder_pages_larger_than_the_configured_limit() {
        let dir = tempfile::tempdir().unwrap();
        let book_dir = dir.path().join("book");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&book_dir).unwrap();
        std::fs::write(book_dir.join("001.jpg"), vec![0_u8; 2 * 1024 * 1024]).unwrap();
        let limits = ArchiveLimits {
            max_entry_bytes: 1024 * 1024,
            ..ArchiveLimits::default()
        };

        assert!(materialize_page_from_source_with_limits(
            &cache_dir,
            &book_dir,
            "001.jpg",
            "cache-key",
            0,
            limits,
        )
        .is_err());
    }

    #[test]
    fn thumbnail_payloads_reference_disk_cache_without_base64_copy() {
        let dir = tempfile::tempdir().unwrap();
        let book_dir = dir.path().join("book");
        let cache_dir = dir.path().join("thumbnails");
        std::fs::create_dir_all(&book_dir).unwrap();
        image::RgbImage::new(8, 8)
            .save(book_dir.join("001.png"))
            .unwrap();

        let generated =
            load_thumbnail_from_source(&cache_dir, &book_dir, "001.png", "thumbnail-key", None, 0)
                .unwrap();
        let disk_path = generated.write.as_ref().unwrap().disk_path.clone();
        let cached = load_thumbnail_from_source(
            &cache_dir,
            &book_dir,
            "001.png",
            "thumbnail-key",
            Some(disk_path),
            0,
        )
        .unwrap();

        assert!(generated.payload.data_url.is_empty());
        assert!(generated.payload.file_path.is_some());
        assert!(cached.write.is_none());
        assert_eq!(cached.payload.file_path, generated.payload.file_path);
    }

    #[test]
    fn materializes_zip_pages_into_the_scoped_reader_cache() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("book.cbz");
        let cache_dir = dir.path().join("reader-pages");
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file("001.jpg", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(PNG_1X1).unwrap();
        archive.finish().unwrap();

        let page =
            materialize_page_from_source(&cache_dir, &archive_path, "001.jpg", "zip-cache-key", 0)
                .unwrap();

        assert_eq!(page.payload.mime_type, "image/jpeg");
        assert_eq!(
            std::fs::read(page.payload.file_path.unwrap()).unwrap(),
            PNG_1X1
        );
    }

    #[test]
    #[ignore = "set MANGAVAULT_READER_BENCHMARK_BOOK_PATH and MANGAVAULT_READER_BENCHMARK_SOURCE_PATH"]
    fn benchmarks_real_page_materialization() {
        let book_path = std::env::var_os("MANGAVAULT_READER_BENCHMARK_BOOK_PATH")
            .map(PathBuf::from)
            .expect("MANGAVAULT_READER_BENCHMARK_BOOK_PATH must be set");
        let source_path = std::env::var("MANGAVAULT_READER_BENCHMARK_SOURCE_PATH")
            .expect("MANGAVAULT_READER_BENCHMARK_SOURCE_PATH must be set");
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path().join("reader-pages");

        let cold_started = std::time::Instant::now();
        let cold = materialize_page_from_source(
            &cache_dir,
            &book_path,
            &source_path,
            "real-page-cache-key",
            0,
        )
        .unwrap();
        let cold_elapsed = cold_started.elapsed();
        let warm_started = std::time::Instant::now();
        let warm = materialize_page_from_source(
            &cache_dir,
            &book_path,
            &source_path,
            "real-page-cache-key",
            0,
        )
        .unwrap();

        eprintln!(
            "real page materialization: cold {:?}, warm {:?}",
            cold_elapsed,
            warm_started.elapsed()
        );
        assert!(cold.wrote);
        assert!(!warm.wrote);
        assert!(cold.payload.data_url.is_empty());
        assert_eq!(cold.payload.file_path, warm.payload.file_path);
    }
}
