# MangaVault Desktop User Guide

## First Start

A new Windows user opens to an empty library with **Add Manga Folder**. You can add multiple independent folders. If MangaVault finds existing local data for the same Windows account, it asks whether to continue with that data, view its location, or create a backup before starting with an empty database.

Application data is separate from source comics. Removing a library or resetting MangaVault data never deletes the original manga unless a future operation explicitly says it will touch source files; V1.0.0 provides no such source-deletion operation.

## Import And Scan

Choose **Add Manga Folder** to scan a directory recursively, or **Import File** to select one or more archives or PDFs. Dragging supported files or folders onto the installed application uses the same background import queue.

Supported inputs are image folders containing JPG, JPEG, PNG, WebP, or AVIF pages; CBZ, CBR, ZIP, RAR, and 7Z archives; and PDF documents. Windows builds include private 7-Zip and Poppler tools.

Scanning runs in the background. The library status area shows progress, cancellation, retry, and saved failure details. A damaged or unsupported item does not remove books already imported. Rescanning marks missing sources without deleting tags, favorites, ratings, progress, or source files.

Downloader layouts containing `original`, `waifu2x`, or another recognized enhanced-version directory are grouped under the logical manga root. MangaVault prefers available enhanced pages and falls back to originals page by page.

## Library

Use grid, list, cover wall, or series view. Search titles, authors, and paths; filter by tags, format, favorite state, rating, reading state, or duplicate checksum; and edit metadata from the context menu.

V1.1 can also search a confirmed JM ID, JMComic source title, author, tag, or category. User tags and source tags both appear in the tag filter, while the source-category filter remains separate. Configure the read-only bridge and optional enrichment under **Settings > Library > JMComic metadata source**; see [V1.1 JMComic Metadata Guide](V1_1_JMCOMIC_READER_METADATA.md).

The default desktop behavior is **double-click to open, single-click to select**. You can switch to **single-click to open** under **Settings > Library**. Enter opens the selected book in either mode. Right-click and controls inside a card do not open the reader.

The main sidebar can be expanded or collapsed. Narrow windows temporarily use the compact form without overwriting your saved preference.

## Reading

The reader supports:

- Single page, double page, and continuous scroll
- Left-to-right and right-to-left reading
- Fit width, fit height, original size, and zoom
- Page thumbnails, page jump, chapter jump, bookmarks, and automatic progress saving
- Brightness, contrast, saturation, grayscale, sharpening, white-border trimming, rotation, and background color
- Mouse hot zones, wheel paging, touchpad input, drag panning, and customizable shortcuts

The current image remains visible until the next page has decoded. Double-page spreads switch as one unit, and failed or stale page requests do not advance saved progress.

Choose **Focus Reading** to enter system fullscreen with the sidebar hidden and controls set to auto-hide. Move to the top or bottom edge or click the center region to reveal controls. A visible top control exits fullscreen with the mouse.

Escape closes the top overlay first, leaves immersive mode second, and leaves normal system fullscreen third. It does not hide the complete Reader UI in a normal window.

## Recent Reading

Recent Reading is a main navigation page. Each manga appears once with its cover, current page, progress, and local last-read time. Search, sort, filter, and switch between grid and list views.

Removing one entry or clearing all Recent history removes only history entries. It does not remove the manga, source files, bookmarks, or saved reading progress. Resetting reading progress is a separate action.

## Settings

The Settings center contains nine categories:

1. General
2. Library
3. Reader
4. Display & Image
5. Keyboard & Mouse
6. Storage & Cache
7. Backup & Local Data
8. Advanced & Diagnostics
9. About

Settings search runs locally and supports Chinese and English terms. Most changes save immediately. A save failure is shown instead of being reported as successful. Restoring a category or all preferences does not delete libraries, history, progress, bookmarks, or backups.

High-risk local database reset is collapsed and separated from cache cleanup. It requires confirmation and a verified WAL-consistent backup before it can be scheduled.

## Backups And Recovery

Use **Settings > Backup & Local Data** to check database health, create a backup, schedule a restore, or prepare a clean database. Restores apply before the database opens on the next start, after MangaVault creates a safety copy of the current database.

Before applying a migration to an existing database, MangaVault creates a `pre-migration` snapshot. If the live database is corrupt, startup isolates it and attempts recovery from a healthy managed snapshot. See [Backup And Recovery](BACKUP_AND_RECOVERY.md) before changing database files manually.

## Logs And Privacy

MangaVault is offline by default and does not upload comics, thumbnails, reading history, local paths, or database content. Optional JMComic metadata is separately enabled and sends only a confirmed numeric JM ID to the selected allowlisted HTTPS endpoint. Release logs are stored under `%LOCALAPPDATA%\com.mangavault.desktop\logs` and can be opened from **Advanced & Diagnostics**.

The application does not bundle OCR, translation, cloud sync, plugin-marketplace, or AI model functionality in V1.1.
