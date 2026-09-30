# Changelog

## 1.1.0-rc.1 - 2026-08-13

- Added read-only discovery and WAL-consistent snapshot inspection of JMComic-qt `download.db` files.
- Added explicit, token-bound exact-path JM ID association without modifying JMComic data or source comics.
- Added an opt-in HTTPS metadata provider with TLS verification, endpoint allowlisting, bounded responses, request throttling, per-ID single-flight, cache expiry, and local job audit records.
- Added source-owned titles, authors, tags, categories, descriptions, and chapter metadata while preserving user titles and user tags.
- Added library search by JM ID and source metadata, unified source/user tag filtering, and source category filtering.
- Added deterministic linking for future imports and optional post-import enrichment without blocking or failing the local scan.
- Added cancellable, token-validated batch enrichment with session single-flight and fresh-cache skipping.
- Added a separate JMComic source section to book metadata details with explicit per-field adoption rather than silent overwrite.
- Database schema advanced to migration 10. Online metadata remains disabled by default.

## 1.0.0 - 2026-08-05

### Released

- Promoted the long-running Windows RC baseline to the first stable MangaVault Desktop release after extended real-machine use found no unresolved core library, scanning, reader, data, shortcut, settings, or Recent Reading defect.
- Finalized the Windows x64 product identity as `1.0.0` and retained the stable MSI UpgradeCode for upgrades from earlier test and RC packages.
- Published final user, backup, privacy, validation, maintenance, and release documentation without changing the frozen database schema or business behavior.

### Verification

- The final release uses the same approved UX-G, UX-H, UX-I, RC-A, RC-B, RC-C, UX-D, UX-E, and UX-F business baseline.
- Full automated gate and final MSI metadata, payload, privacy, and hash evidence are recorded in `RELEASE_CHECKLIST.md` and `docs/V1_FINAL_VALIDATION.md`.

## 1.0.0-rc.3 - 2026-07-22

### Changed

- Added a persistent, responsive collapsible application sidebar and unified single-click/double-click book activation across library, series, search, and Recent views.
- Added one-click Focus Reading while preserving advanced fullscreen and immersive controls, Escape safety ordering, return context, and mouse-only exit paths.
- Replaced the long Settings page with a nine-category settings center, local bilingual search, category-level reset, clear save feedback, and a separated collapsed danger zone.
- Promoted Recent Reading to a dedicated paginated and virtualized page with deduplication, search, filters, sorting, state restoration, and history operations that preserve progress and bookmarks.

### Verification

- Passed Prettier, zero-warning ESLint, TypeScript typecheck, 166 Vitest tests, 57 Playwright E2E tests, Rust fmt, Clippy with warnings denied, 113 Rust tests, migration tests, and migrated-database `quick_check`.
- Verified the 79/80/81 Recent pagination boundary, stable tie ordering, search totals, deletion, clear, refresh, and a virtualized 10,000-record UI case.
- Built one unsigned per-machine Windows x64 RC3 artifact. The app displays `1.0.0 RC3`; MSI ProductVersion is `1.0.2`; UpgradeCode remains stable.
- Audited the final MSI and extracted payload for private paths, private usernames, databases, logs, fixtures, covers, thumbnails, and source-workspace paths; no prohibited content was found.

## 1.0.0-rc.2 - 2026-07-14

### Changed

- Added a safe first-run and existing-data flow with explicit data-location, backup, and reset choices; reset is gated by a healthy WAL-consistent backup and never deletes source manga.
- Made Windows long paths reader-friendly in the UI while preserving canonical paths internally, and clarified recent-reading titles, page counts, and local timestamps.
- Reworked paged reading around decoded standby buffers and generation-checked atomic commits. Failed or stale requests keep the previous page and progress, and double-page spreads commit as one unit.
- Added automatic, overlay, and reserved-space control layouts without resizing the visible comic when controls show or hide.
- Unified reader pointer gestures so side zones page immediately while center click and optional double-click zoom are arbitrated without cross-triggering.
- Replaced scattered key handlers with one persisted Shortcut Registry supporting multiple bindings, scope-aware conflicts, replacement, and default restoration.

### Verification

- Passed Prettier, ESLint, TypeScript typecheck, 133 Vitest tests, 36 Playwright E2E tests, Rust fmt, Clippy with warnings denied, 110 executed Rust tests, and the 5-test database migration integration suite.
- Built the Tauri Release executable and one unsigned, per-machine Windows x64 RC2 MSI.
- RC2 displays `1.0.0 RC2`; its MSI ProductVersion is `1.0.1` so it upgrades RC1 `1.0.0`. UpgradeCode remains `{95C5D5E5-3BEE-58E3-B959-6A94A261CF74}`.

## 1.0.0-rc.1 - 2026-07-14

### Fixed

- Prevented page navigation from repeatedly probing 7-Zip/PDF capabilities or opening visible Windows child-process consoles; concurrent callers now share one session probe.
- Unified reader windowed, fullscreen, immersive, overlay, and tutorial states with strict Escape priority, guarded LTR/RTL click zones, mouse-only fullscreen exit, and interaction-aware automatic hiding.
- Preserved logical source titles exactly during metadata extraction. Comic Market and other event codes such as `(C107)`, COMITIA, and COMIC1 are no longer treated as chapters or removed from display titles.
- Stopped chapter extraction from treating prose such as `100回イかない` as a chapter while retaining explicit Chapter/Ch/第 N 话、章、篇、回 and N 話 markers.
- Added a virtual, on-demand page-thumbnail filmstrip with current-page location and keyboard/mouse navigation.
- Consolidated image adjustments with per-setting and full reset behavior. Legacy invert remains compatible but is hidden from the normal V1 menu and can still be disabled through its advanced notice.

### Controlled Data Repair

- Validated legacy event-code repair against exact parser output. Only fully qualified title/chapter matches are eligible; ambiguous records remain unchanged for manual review.
- Created and health-checked a WAL-consistent managed backup before the single repair transaction. The protected database fingerprint and counts were unchanged, `quick_check=ok`, and a stale-token rerun was rejected without creating another backup.

### Verification

- Passed 86 Vitest tests, 22 Playwright E2E flows, Rust all-target tests, ESLint, TypeScript typecheck, Rust fmt/Clippy, and a Tauri Release build without bundling.
- Generated one unsigned, per-machine Windows x64 MSI for external RC validation. Its internal ProductVersion is `1.0.0`, and its UpgradeCode remains compatible with the previous test packages.

## 0.1.2 - Feature Complete Preview

This Windows preview is for focused real-machine validation before the V1 RC.

### Changed

- Reworked settings around user-facing library roots, reader defaults, keyboard help, cache/data maintenance, privacy, and hidden advanced diagnostics.
- Added safe per-library removal with an explicit preview; it removes MangaVault records and generated thumbnails only, never the source comic files.
- Added clear recent-reading, clear generated caches, and reset-preferences actions with scoped safety messaging.
- Reorganized the reader: compact primary controls, image-adjustment popover with reset, bookmark list, thumbnail navigation, immersive reading, and clear fullscreen behavior.
- Replaced the misleading image "night mode" label with the accurate "invert" image effect while preserving existing stored preferences.
- Replaced broad mouse/key UI wakeups with guarded edge activation and interaction-aware automatic hiding.
- Changed Release Windows binaries to the GUI subsystem, retained file/crash logs in the local log directory, and filtered debug-only framework noise from Release logs.
- Bundled verified private 7-Zip and Poppler reader tools in Windows installers for RAR/CBR/7Z and PDF reading.

### Preview Validation Focus

- Validate first launch, multiple library roots, source-safe library removal, reader immersion/fullscreen, and browser/keyboard controls.
- Validate a clean Windows user can open RAR/7Z/CBR/PDF without installing separate tools.
- Validate the application launches without a console and writes Release logs under `%LOCALAPPDATA%\\com.mangavault.desktop\\logs`.

## 0.1.1 - Manual Validation Build

This is a Windows manual-validation build, not an RC or final release.

### Changed

- Strengthened scanner lifecycle handling for changed, moved, and empty image folders.
- Stabilized reader spread alignment, RTL page controls, wheel throttling, and compact-layout accessibility.
- Improved downloader-layout grouping so `original` and supported enhanced versions are one logical book with per-page fallback.
- Added persisted scan-failure details and safer metadata-save recovery.
- Hardened archive resource limits, external 7-Zip argument handling, compression-ratio validation, and folder-link containment.
- Added database snapshot recovery, pre-migration backups, migration rollback coverage, and startup health evidence.
- Added a confirmed, deferred database restore flow that validates managed snapshots and preserves a `pre-restore` safety copy before the next startup.
- Improved Chinese-first formatting and recoverable errors: dates and numbers follow the selected language, managed backup reasons are localized, and known database/page failures have stable Chinese and English messages.
- Replaced reader trim-white and sharpen placeholders with opt-in Rust image processing, including conservative white-border cropping and transform-aware page caches.
- Added an isolated Tauri smoke configuration for native startup verification without using a normal application identifier.

### Known Validation Limits

- The Windows installer remains English and unsigned.
- RAR/CBR/7Z and PDF rendering depend on local external tools; the installer does not bundle them.
- Clean install, upgrade, association, uninstall, and data-retention behavior require the manual matrix in `docs/WINDOWS_INSTALLATION_VALIDATION.md`.
- Native import, scan, read, progress, bookmark, and restart verification still requires the installed-app smoke procedure.
