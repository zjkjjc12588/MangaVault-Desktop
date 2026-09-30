# MangaVault Desktop 1.0.0 Release Checklist

Last updated: 2026-08-05

## Frozen Baseline

- [x] UX-G, UX-H, UX-I, and all preceding V1 stabilization batches are approved.
- [x] Business behavior is frozen; no database migration or schema change was added.
- [x] Application display version and MSI ProductVersion are `1.0.0`.
- [x] Database migration version remains `8`.
- [x] Git metadata is unavailable; no commit hash is claimed.
- [x] Build identifier is `MV-1.0.0-FINAL-20260805-170126-CST-NOGIT`.

## Full Quality Gate

- [x] Prettier check passed.
- [x] ESLint passed with zero warnings.
- [x] TypeScript `tsc --noEmit` passed.
- [x] Vitest: 28 files and 166 tests passed.
- [x] Playwright: 57 tests passed with the proven stable 4-worker configuration.
- [x] `cargo fmt --check` passed.
- [x] `cargo clippy --all-targets -- -D warnings` passed.
- [x] Rust: 113 tests passed; 5 explicit real-library/performance tests ignored.
- [x] Database migration integration suite: 6 passed, including `quick_check=ok`.
- [x] Vite production build passed.
- [x] Tauri Release build passed.
- [x] Windows x64 MSI build passed.

## Installer

- [x] Final filename is `MangaVault-1.0.0-x64.msi`.
- [x] MSI ProductVersion is `1.0.0`.
- [x] ProductCode is `{2E55104B-4F58-4834-980A-FD16C759491F}`.
- [x] UpgradeCode remains `{95C5D5E5-3BEE-58E3-B959-6A94A261CF74}`.
- [x] Major-upgrade handling permits replacement of earlier RC packages whose internal numeric version was higher.
- [x] Install scope is per-machine (`ALLUSERS=1`).
- [x] Release EXE uses the Windows GUI subsystem.
- [x] The MSI is the only installer in `release/v1.0.0/`.

## Privacy And Payload

- [x] Release-specific Tauri configuration removes the development URL from the executable.
- [x] MSI and installed payload contain no private comic path, private build path, development server address, fixture identifier, or user data.
- [x] No database, history, log, cover, thumbnail, crash report, or model file is bundled.
- [x] Rust source paths are remapped and no private build-account path remains in the release package.
- [x] The application does not start a development server or depend on the source tree.
- [x] Runtime data remains under the Windows user profile, outside the installation directory.

## Artifact

MSI: `release/v1.0.0/MangaVault-1.0.0-x64.msi`  
Size: `18,833,408 bytes` (`17.96 MiB`)  
SHA-256: `2F4183E84DE1B84D78A819DBB15207101E818408E49C5E248946D4543052FCFB`  
Build time: `2026-08-05 17:01:26 +08:00`  
Signature: Not signed

## Known Non-Blocking Warnings

- Vite reports the 595.71 kB main JavaScript chunk above its 500 kB advisory.
- Cargo reports a PDB filename collision between bin and lib targets; PDB files are not bundled.
- Windows may display an unknown-publisher warning because the MSI is unsigned.
- A machine without WebView2 may need a one-time network connection for Microsoft's Evergreen runtime bootstrapper.

Status: **V1.0.0 Final generated and frozen.**
