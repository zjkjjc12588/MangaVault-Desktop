# MangaVault Desktop 1.0.0 Build Information

## Identity

- Build identifier: `MV-1.0.0-FINAL-20260805-170126-CST-NOGIT`
- Build time: `2026-08-05 17:01:26 +08:00`
- Source version: frozen V1.0.0 workspace after the approved UX-G, UX-H, and UX-I checkpoints
- Git commit: unavailable; the workspace does not contain usable Git metadata
- Application display version: `1.0.0`
- MSI ProductVersion: `1.0.0`
- Database migration/schema version: `8`

## Installer

- File: `MangaVault-1.0.0-x64.msi`
- Architecture: Windows x64
- Install scope: per-machine (`ALLUSERS=1`)
- Size: `18,833,408 bytes` (`17.96 MiB`)
- SHA-256: `2F4183E84DE1B84D78A819DBB15207101E818408E49C5E248946D4543052FCFB`
- ProductCode: `{2E55104B-4F58-4834-980A-FD16C759491F}`
- UpgradeCode: `{95C5D5E5-3BEE-58E3-B959-6A94A261CF74}` (stable)
- Signature: not signed
- WebView2: silent Evergreen download bootstrapper when the runtime is absent

## Quality Gate

- Prettier: passed
- ESLint: passed with zero warnings
- TypeScript: passed
- Vitest: 166 passed in 28 files
- Playwright: 57 passed with 4 workers
- Rust: 113 passed, 5 ignored
- Database migration integration tests: 6 passed
- Database `quick_check`: `ok`
- Rust fmt: passed
- Clippy all targets with warnings denied: passed
- Vite production build: passed
- Tauri Release build: passed
- Windows MSI build: passed

## Package Audit

The final MSI and administrative-install payload were scanned for private comic paths, the private Windows username and workspace path, development server URLs, fixture identifiers, databases, logs, reading history, covers, thumbnails, crash reports, and model files. No prohibited item was found in the original MSI or installed application payload.

The release executable uses the Windows GUI subsystem and does not contain the Tauri development URL. The package contains the application, licenses/notices, and intended private 7-Zip and Poppler runtime tools only.

## Non-Blocking Warnings

- Vite main chunk advisory: 595.71 kB exceeds the default 500 kB warning threshold.
- Cargo emits a bin/lib PDB filename-collision warning; no PDB is bundled.
- The MSI is unsigned.
