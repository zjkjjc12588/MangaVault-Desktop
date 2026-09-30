# Windows Installation Validation

## Candidate

| Field             | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Candidate         | `0.1.1 r8` manual validation build                                 |
| MSI               | `MangaVault Desktop_0.1.1_x64_en-US.msi`                           |
| MSI SHA-256       | `69FDE0C854B3F688F9446F57EACF3602902BEF5CBD18D9B39246FA2EC3E5C36B` |
| NSIS EXE          | `MangaVault Desktop_0.1.1_x64-setup.exe`                           |
| EXE SHA-256       | `E90C81308836CA4B9F69FD6CE100A012E7CC4B345DAF21F67580D4763B523A1F` |
| Package directory | `release/mangavault-desktop-0.1.1-20260711-r8`                     |

## Automated Evidence

| Check                                                                | Result                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Frontend lint, TypeScript, unit tests, production build, browser E2E | Passed: 69 unit tests and 13 browser E2E tests                                                            |
| Rust fmt and Clippy                                                  | Passed                                                                                                    |
| Rust unit and integration tests                                      | Passed: 71 unit tests, 1 ignored performance gate, 9 integration tests                                    |
| Tauri production build                                               | Passed: MSI and NSIS EXE generated with version `0.1.1`                                                   |
| Isolated native startup                                              | Passed: native window, WebView, frontend response, SQLite quick-check, migration, and seed initialization |

## Manual Matrix

Run every item on a Windows test account or VM. Record `Pass`, `Fail`, `Blocked`, or `Not Run` with a short note and date.

| ID    | Scenario                                                | Expected Result                                                                                                                  | Status  | Notes |
| ----- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| WI-01 | Verify hashes before installation                       | Both hashes match this document                                                                                                  | Not Run |       |
| WI-02 | Clean MSI installation                                  | Installer completes; Start menu entry launches MangaVault                                                                        | Not Run |       |
| WI-03 | Clean NSIS installation                                 | Installer completes; Start menu entry launches MangaVault                                                                        | Not Run |       |
| WI-04 | Launch after clean installation                         | Library opens without crash; Settings shows database health `OK`                                                                 | Not Run |       |
| WI-05 | Import a small image-folder comic                       | Scan completes; one logical book appears with cover and correct page count                                                       | Not Run |       |
| WI-06 | Open, page, bookmark, close, reopen                     | Reader restores progress and bookmark remains                                                                                    | Not Run |       |
| WI-07 | Import a representative `<sample-library>` subset | `original` and enhanced folders merge; incomplete enhancement falls back per page                                                | Not Run |       |
| WI-08 | Rescan a changed, empty, and moved image folder         | Changed pages refresh; empty/moved book becomes Missing without metadata loss                                                    | Not Run |       |
| WI-09 | File association from Explorer, app closed              | Supported archive starts MangaVault, queues import, and opens after scan                                                         | Not Run |       |
| WI-10 | File association while app is running                   | Existing window receives the archive path and queues import                                                                      | Not Run |       |
| WI-11 | Upgrade 0.1.0 to 0.1.1                                  | Existing library, progress, bookmarks, and settings remain available                                                             | Not Run |       |
| WI-12 | Uninstall                                               | Application binaries are removed; user data retention/removal behavior is recorded                                               | Not Run |       |
| WI-13 | Reinstall after uninstall                               | Expected retained data behavior is observed and documented                                                                       | Not Run |       |
| WI-14 | Open Settings and create a database backup              | Backup succeeds and its location is accessible                                                                                   | Not Run |       |
| WI-15 | Missing external tools                                  | RAR/CBR/7Z/PDF capability state and errors are accurate; app remains usable                                                      | Not Run |       |
| WI-16 | Schedule and apply a database restore                   | Settings lists the managed snapshot, confirmation schedules it, restart restores it, and a `pre-restore` safety snapshot remains | Not Run |       |

## Reporting Rules

- Do not overwrite or delete the production application database while testing recovery, upgrade, or uninstall behavior.
- Attach the exact installer filename, Windows version, and a timestamp to every failure.
- A P0 failure is a crash, data loss, security issue, startup failure, or unusable import/read path. Record it immediately in `STABILIZATION_BACKLOG.md`.
- Do not generate another installer for an ordinary UI or copy issue. Group normal findings into the existing stabilization backlog.
