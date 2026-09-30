# MangaVault Desktop 1.1.0 RC1 Release Checklist

Status: automated quality gate complete; Windows external validation pending  
Target: one unsigned Windows x64 external-validation MSI

## Version And Upgrade

- [x] Display version is `1.1.0 RC1`.
- [x] Tauri/Cargo/package semantic version is `1.1.0-rc.1`.
- [x] MSI ProductVersion is `1.0.100`, which is newer than V1.0.0 and lower than future V1.1.0.
- [x] UpgradeCode remains `95c5d5e5-3bee-58e3-b959-6a94a261cf74`.
- [x] No Git commit hash is claimed when repository metadata is unavailable.

## Full Gate

- [x] Prettier check
- [x] ESLint with zero warnings
- [x] TypeScript typecheck
- [x] Full Vitest suite: 167 passed
- [x] Full Playwright suite with four stable workers: 59 passed
- [x] `cargo fmt --check`
- [x] `cargo clippy --all-targets -- -D warnings`
- [x] Full Rust tests and migration tests: 130 passed, 5 environment benchmarks ignored
- [x] Vite production build
- [x] Tauri Release no-bundle build
- [x] One Windows x64 MSI build

## V1.1 Regression

- [x] Read-only JMComic discovery and token-bound exact identity import
- [x] Migration 10 and database `quick_check`
- [x] Source/user metadata ownership separation
- [x] JM ID/source title/tag/category search and filtering
- [x] Future-import exact linking and non-blocking optional enrichment
- [x] Batch preview, stale-token rejection, session single-flight, cancellation, and fresh-cache skipping
- [x] Offline default and disabled-provider request prevention

## Privacy And Payload

- [x] No private manga paths, user database, covers, thumbnails, logs, or JMComic database in the MSI.
- [x] No development server URL or debug console in the release application.
- [x] No credentials, cookies, or copied JMComic configuration.
- [x] No bundled model files.
- [x] MSI SHA-256 and build metadata recorded.

## External Validation

- [x] `docs/V1_1_RC1_EXTERNAL_VALIDATION.md` ships beside the MSI.
- [x] Real endpoint compatibility has not been claimed before Windows validation.
- [x] The release directory contains exactly one V1.1 RC1 MSI.
