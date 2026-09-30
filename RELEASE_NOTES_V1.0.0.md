# MangaVault Desktop 1.0.0 Release Notes

MangaVault Desktop 1.0.0 is the first stable Windows x64 release. It is a local-first manga library and reader designed for large personal collections and long reading sessions.

## Core Features

### Supported Formats

- Image folders containing JPG, JPEG, PNG, WebP, or AVIF pages
- CBZ, CBR, ZIP, RAR, and 7Z archives
- PDF documents

The Windows installer bundles private 7-Zip and Poppler tools. Users do not need to install those tools globally.

### Manga Library

- Multiple independent library folders and recursive background scanning
- Incremental rescanning, cancellation, progress, retry, and saved failure details
- Grid, list, cover wall, and series views with virtualized rendering
- Search, sorting, advanced filters, tags, favorites, ratings, and duplicate detection
- Metadata editing and source-folder access
- Logical grouping of `original`, `waifu2x`, and recognized enhanced download layouts
- Conservative title parsing that preserves Comic Market, COMITIA, COMIC1, punctuation, and legal brackets

### Reader

- Single-page, double-page, and continuous-scroll modes
- LTR and RTL reading direction
- Fit width, fit height, original size, and zoom
- Page and chapter navigation, virtualized thumbnails, bookmarks, and automatic progress restoration
- Brightness, contrast, saturation, grayscale, sharpening, border trimming, rotation, and configurable background
- Decoded standby pages, generation-safe commits, double-page atomic switching, and bounded caches to avoid visible blank frames

### Focus Reading

Focus Reading enters system fullscreen and hides non-reading navigation in one action. Controls auto-hide and can be restored with narrow edge zones or a deliberate center click. Mouse users always have a visible exit path when controls are shown, and Escape follows a fixed overlay, immersive, and fullscreen safety order.

### Recent Reading

Recent Reading is a dedicated main page with grid/list views, search, sorting, filters, progress, and local last-read time. Each manga appears once. Removing or clearing history does not delete the manga, bookmarks, or reading progress.

### Settings, Shortcuts, And Gestures

The Settings center uses nine focused categories and local Chinese/English search. It includes theme and language, library folders, reader defaults, image settings, storage, backup, diagnostics, editable keyboard shortcuts, and mouse gestures.

The shortcut registry supports multiple bindings per command, conflict detection, confirmed replacement, per-command reset, full reset, scope priority, IME protection, and persistence. Mouse paging, center click, optional double-click zoom, wheel behavior, and drag panning can be configured without delaying side-zone page turns.

## Local Data And Privacy

MangaVault runs offline by default and does not upload comics, pages, covers, thumbnails, metadata, history, or logs. User data is stored under the Windows user profile and is separate from the installation directory and source comics.

No AI model, OCR, translation, cloud-sync client, plugin marketplace, or telemetry uploader is included in V1.0.0.

## Install And Upgrade

Install `MangaVault-1.0.0-x64.msi` on Windows 10 or Windows 11 x64. The installer is per-machine and uses Microsoft Edge WebView2. If WebView2 is absent, setup may need network access once to obtain the Evergreen runtime.

The UpgradeCode remains compatible with earlier MangaVault Windows test and RC installers. Covering an earlier installation preserves the library database, reading progress, settings, shortcuts, bookmarks, and history stored in AppData.

The V1.0.0 MSI is unsigned, so Windows may display an unknown-publisher warning. Verify `SHA256SUMS.txt` before installation.

## Backup Before Upgrade

Open **Settings > Backup & Local Data** and create a database backup before an important upgrade or recovery exercise. MangaVault verifies managed backups with SQLite `quick_check`. Restores are scheduled for the next start and create a safety snapshot before replacing the live database.

Backups contain MangaVault metadata and reading state, not source comic files. Continue backing up source comics separately.

## Known Limits

- V1.0.0 provides an official Windows x64 installer only. macOS and Linux packages are not formally released.
- The MSI is unsigned.
- A machine without WebView2 may require internet access during setup for the Microsoft runtime bootstrapper.
- Automatic updates have a reserved interface but no configured public update channel.
- Chapter detection is deliberately conservative; uncertain filenames may require manual metadata editing.
- macOS and Linux source builds require system archive/PDF tools and are outside this release's support matrix.

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) and [Backup And Recovery](docs/BACKUP_AND_RECOVERY.md) for operational details.
