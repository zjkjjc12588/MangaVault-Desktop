# MangaVault Desktop

MangaVault Desktop 1.1.0 RC1 is a local-first manga library and reader for Windows. The application is built with Tauri 2, Rust, React, TypeScript, Vite, Zustand, Radix UI, and SQLite.

V1.1 RC1 is a Windows x64 external-validation build. The source retains cross-platform architecture, but macOS and Linux installers are not part of this validation release.

## Highlights

- Import multiple folders or individual comic files and scan subdirectories in the background.
- Read image folders, CBZ, CBR, ZIP, RAR, 7Z, and PDF files. The Windows installer bundles private 7-Zip and Poppler tools.
- Browse a virtualized grid, list, cover wall, or series view with search, filters, tags, favorites, ratings, duplicate detection, and metadata editing.
- Preserve Comic Market and other event markers such as `(C107)`, COMITIA, and COMIC1 in titles.
- Read in single-page, double-page, or continuous-scroll mode with LTR/RTL direction, fit modes, zoom, image controls, thumbnails, bookmarks, and automatic progress restoration.
- Enter Focus Reading in one action, with fullscreen, auto-hiding controls, mouse hot zones, and a reliable mouse and Escape exit path.
- Resume books from the dedicated Recent Reading page without clearing reading progress when history entries are removed.
- Customize keyboard shortcuts and reader mouse gestures from the nine-category Settings center.
- Read JM IDs from a WAL-consistent, read-only snapshot of JMComic-qt `download.db`, then explicitly confirm exact logical-root links.
- Optionally fetch source-owned JMComic titles, authors, tags, categories, and descriptions; search by JM ID or source metadata and filter by source tag/category without overwriting user metadata.
- Link future imports to JM IDs after deterministic path matching, with optional post-import enrichment and token-bound, cancellable batch refresh.
- Keep the library, reading progress, settings, shortcuts, history, backups, caches, and logs in the Windows user profile rather than the installation directory.

MangaVault never uploads local comics and runs offline by default. JMComic network metadata is disabled until the user explicitly enables it; enabled requests send only a confirmed numeric JM ID to the selected allowlisted HTTPS endpoint.

## Install On Windows

Run `MangaVault-1.1.0-rc.1-x64.msi` on Windows 10 or Windows 11 x64. The installer uses Microsoft Edge WebView2; when WebView2 is absent, the installer may need network access once to obtain the Evergreen runtime.

The unsigned validation installer may show an unknown-publisher warning. Verify the SHA-256 value published beside the installer before installing.

Upgrading from an earlier MangaVault test or RC installer preserves data stored under the Windows user profile. Uninstalling the application does not silently delete the manga library database or source comics.

## Supported Formats

- Image folders: JPG, JPEG, PNG, WebP, AVIF
- Archives: CBZ, CBR, ZIP, RAR, 7Z
- Documents: PDF

Archive and image limits protect against path traversal, excessive expansion, oversized pages, and malformed inputs. A failed book does not roll back successfully imported books.

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [Keyboard Shortcuts And Gestures](docs/SHORTCUTS.md)
- [Backup And Recovery](docs/BACKUP_AND_RECOVERY.md)
- [Privacy](docs/PRIVACY.md)
- [Known Issues](KNOWN_ISSUES.md)
- [V1.0.0 Release Notes](RELEASE_NOTES_V1.0.0.md)
- [V1.1 JMComic Metadata Guide](docs/V1_1_JMCOMIC_READER_METADATA.md)

## Development

Install Node.js 22, Rust stable, Microsoft C++ Build Tools, the Windows SDK, and WebView2 development prerequisites.

```powershell
npm install
npx playwright install chromium
npm run tauri:dev:msvc
```

Quality checks:

```powershell
npx prettier --check .
npm run lint
npx tsc --noEmit
npm test
npm run e2e
scripts\cargo-msvc.cmd cargo fmt --manifest-path src-tauri\Cargo.toml --check
scripts\cargo-msvc.cmd cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
scripts\cargo-msvc.cmd cargo test --manifest-path src-tauri\Cargo.toml
```

Build the Windows installer with:

```powershell
npm run release:windows
```

Generated installers are placed under `src-tauri/target/release/bundle`. See [Building](docs/BUILDING.md) for platform development prerequisites. V1.1 RC1 is validated on Windows x64.

## Maintenance

V1.0.x accepts only P0/P1 fixes. V1.1 currently contains only the approved JMComic metadata scope; unrelated feature work remains deferred. See [Roadmap](ROADMAP.md) and [V1.1 Backlog](V1_1_BACKLOG.md).
