# MangaVault Desktop 1.0.0 Final Validation

Use `PASS`, `FAIL`, or `BLOCKED`. Record screenshots and log paths in Notes when applicable.

## Release Evidence

| Check                                      | Status | Notes                                                     |
| ------------------------------------------ | ------ | --------------------------------------------------------- |
| Display and MSI version are 1.0.0          | PASS   | ProductVersion verified from MSI Property table           |
| UpgradeCode remains stable                 | PASS   | `{95C5D5E5-3BEE-58E3-B959-6A94A261CF74}`                  |
| Final package contains one x64 MSI         | PASS   | `release/v1.0.0/MangaVault-1.0.0-x64.msi`                 |
| Release starts without a console subsystem | PASS   | PE header reports Windows GUI subsystem                   |
| Development URL is absent                  | PASS   | Binary and payload scan: zero hits                        |
| Private paths and user data are absent     | PASS   | MSI and payload scan: zero prohibited hits                |
| Automated quality gate                     | PASS   | 166 Vitest, 57 Playwright, 113 Rust; 5 ignored benchmarks |
| Migration and database health tests        | PASS   | 6 migration tests; `quick_check=ok`                       |

## Installation And Upgrade

| Check                                                                              | Status  | Notes / evidence                                                                     |
| ---------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| Clean install on Windows 10 x64                                                    | BLOCKED | Final MSI-specific external run                                                      |
| Clean install on Windows 11 x64                                                    | BLOCKED | Final MSI-specific external run                                                      |
| Upgrade from RC2/RC3 succeeds                                                      | BLOCKED | Stable UpgradeCode and major-upgrade metadata verified; run on a retained RC install |
| Upgrade preserves libraries, progress, bookmarks, history, settings, and shortcuts | BLOCKED | Verify on external retained data                                                     |
| Formal app starts without CMD/PowerShell windows                                   | BLOCKED | GUI subsystem verified statically; confirm on target Windows                         |
| File associations open supported archives/PDF                                      | BLOCKED | Verify Explorer launch                                                               |
| Uninstall leaves AppData intact by default                                         | BLOCKED | Confirm retained-data behavior                                                       |
| Reinstall discovers retained local data with accurate wording                      | BLOCKED | Confirm once after uninstall/reinstall                                               |

## Library And Data Safety

| Check                                                        | Status | Notes / evidence                       |
| ------------------------------------------------------------ | ------ | -------------------------------------- |
| New Windows user receives the multi-folder empty state       | PASS   | Covered by Playwright                  |
| Existing-data acknowledgement is accurate and not repeated   | PASS   | Covered by Playwright                  |
| Multiple folders import and rescan independently             | PASS   | Automated and prior Windows validation |
| Clear Recent preserves books, progress, and bookmarks        | PASS   | Rust and Playwright coverage           |
| Database reset requires a verified backup                    | PASS   | Rust and Playwright coverage           |
| Backup failure blocks destructive reset                      | PASS   | Rust coverage                          |
| Friendly UI paths preserve internal long/UNC paths           | PASS   | Automated coverage                     |
| Source comic files are never removed by library/data cleanup | PASS   | Service and reset contract coverage    |

## Reader

| Check                                                           | Status  | Notes / evidence                                        |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| Single, double, and continuous modes                            | PASS    | Automated and prior Windows validation                  |
| LTR/RTL page order and pointer zones                            | PASS    | Automated and prior Windows validation                  |
| Cold page load keeps committed image visible                    | PASS    | Playwright delayed-decode regression                    |
| Double spread commits atomically                                | PASS    | Playwright regression                                   |
| Failed page keeps prior image and progress                      | PASS    | Playwright regression                                   |
| Focus Reading enters in one action                              | PASS    | Automated and prior Windows validation                  |
| Mouse-only fullscreen exit and library return                   | PASS    | Automated and prior Windows validation                  |
| Shortcut editing, conflicts, reset, persistence, and IME guards | PASS    | Vitest and Playwright coverage                          |
| Thumbnail virtualization and current-page positioning           | PASS    | Playwright coverage                                     |
| Long session on low-memory/mechanical-disk hardware             | BLOCKED | Optional representative hardware check; no known defect |

## Final Sign-Off

- [x] No confirmed P0 or P1 defect remains open.
- [x] V1.0.0 business code is frozen.
- [x] Release documentation and checksum accompany the MSI.
- [ ] Optional final MSI smoke installation recorded above.

Any post-release P0/P1 issue belongs in `V1_HOTFIX_BACKLOG.md`. P2/P3 requests belong in `V1_1_BACKLOG.md` and must not change the V1.0.0 artifact.
