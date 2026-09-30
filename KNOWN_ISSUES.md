# MangaVault Desktop 1.0.0 Known Issues

No confirmed P0 or P1 product defect is open at the time of release.

## Distribution Limits

- The Windows x64 MSI is not digitally signed. Windows may show an unknown-publisher or reputation warning. Verify the published SHA-256 before installation.
- Microsoft Edge WebView2 is required. Setup uses Tauri's silent Evergreen bootstrapper when the runtime is missing, which may require network access.
- V1.0.0 does not include an active public auto-update channel. Install maintenance releases manually.
- macOS and Linux binaries are not part of the official V1.0.0 release.

## Behavior To Be Aware Of

- Uninstalling MangaVault preserves per-user application data by default. This protects the library database and reading progress. Use the confirmed reset action under **Backup & Local Data** when a clean database is required.
- Database backups contain library metadata, settings, history, bookmarks, and progress. They do not copy original comic archives or image folders.
- Filename chapter parsing is conservative. Ambiguous tokens are kept in the title and may require manual chapter metadata editing.
- Very large first scans remain limited by storage speed, archive compression, and image dimensions. Scanning remains cancellable and does not block the main UI.

Report installation, startup, data-integrity, scanning, reading, or severe performance failures as P0/P1 candidates in `USER_FEEDBACK.md`.
