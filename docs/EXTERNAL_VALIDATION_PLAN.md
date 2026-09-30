# MangaVault Desktop External Validation Batch

**Candidate:** `0.1.1 r9`  
**Date:** 2026-07-12  
**Status:** Pending production gates and one MSI build  
**Purpose:** Validate behaviors that require a real Windows installation, shell integration, native file dialogs, and persisted desktop data. This is a single external-validation batch, not a set of per-case builds.

## Batch Rules

- Run the production build and the complete automated test suite before creating the MSI.
- Publish exactly one MSI for every validation item in this document.
- After the MSI is created, do not make product, source, or documentation changes before receiving the validation report, unless a P0 or P1 issue is found.
- Test database recovery only in a disposable Windows user profile, VM, or isolated test data directory. Do not manipulate a normal reading library database.
- Never attach private comics to a failure report. Use file names, sizes, hashes, and logs instead.

## Candidate Artifact

The release artifact is created only after the gates below pass.

- Expected package directory: `release\\mangavault-desktop-0.1.1-20260712-r9-external-validation`
- Expected MSI: `MangaVault Desktop_0.1.1_x64_en-US.msi`
- Required evidence before distribution: `npm run check`, Rust format, Clippy, Rust unit/integration tests, and a Tauri production MSI build.

## Common Preparation

Prepare one disposable Windows 10/11 x64 test account or VM. Install Microsoft Edge WebView2 Runtime if it is not already present. Keep an earlier MangaVault MSI (for example, the previous `0.1.1 r8` candidate) for the upgrade case.

Create or collect these non-sensitive fixtures:

- A small image-folder comic with at least two JPG, PNG, WEBP, or AVIF pages.
- A representative subset of `<sample-library>` containing an original and a waifu2x/super-resolution variant, plus a multi-chapter title where practical.
- A valid CBZ for file-association testing.
- One deliberately invalid or truncated RAR, 7Z, and PDF sample. Keep each sample small.
- A test-only MangaVault library and a database backup made from Settings for recovery testing.

For every failure, collect the candidate MSI name and SHA-256, Windows version and display language, exact time, reproduction steps, screenshots or a short screen recording, and these files when present:

- `%LOCALAPPDATA%\\com.mangavault.desktop\\logs\\*`
- The test-only SQLite database plus sibling `-wal`, `-shm`, `*.backup-*.sqlite3`, `*.pre-restore-*.sqlite3`, and `*.corrupt-*.sqlite3` files.
- Windows Event Viewer crash entries for MangaVault, WebView2, or the installer.
- For installer failures, an MSI verbose log created with: `msiexec /i "<MSI path>" /L*v "%TEMP%\\MangaVault-msi-install.log"`.

## Acceptance Items

### EV-01: Clean Install and First Launch

- **Prerequisites:** A clean Windows test account/VM with no MangaVault installation and no existing MangaVault app-data directory.
- **Steps:** Install the candidate MSI normally; launch MangaVault from the Start menu; switch between Chinese, English, dark, light, and system appearance; close and reopen the app.
- **Expected result:** Installation completes without repair prompts or missing runtime errors. The app starts promptly, shows Chinese as the default UI language, accepts locale/theme changes, and retains settings after restart.
- **Failure logs:** Common collection, installer verbose log, and a screenshot of the first visible error.
- **Blocks V1 release:** **Yes.**

### EV-02: Native Tauri Import and Background Scan

- **Prerequisites:** A successful EV-01 installation and the image-folder fixture. Use the installed app, not `npm run dev`.
- **Steps:** Use the native folder picker to add the fixture; start scanning; keep navigating/searching while the scan runs; cancel one scan and run it again; rescan after adding or removing a page/file.
- **Expected result:** The native picker opens, scan progress remains visible, the UI stays responsive, cancellation is safe, incremental rescan updates the library, and missing files are handled without corrupting existing entries.
- **Failure logs:** Common collection, scan status screenshots, and the selected fixture paths/file counts (no comic contents).
- **Blocks V1 release:** **Yes.**

### EV-03: Downloader Layout, Variant Association, and Chapter Grouping

- **Prerequisites:** EV-02 and the representative subset from `<sample-library>` with original/waifu2x variants and multiple chapters.
- **Steps:** Import the subset; compare library cards, series grouping, chapter grouping, and the resolved preferred reading source; open several chapters; remove or add a variant and rescan.
- **Expected result:** Original and super-resolution copies of the same work do not appear as unrelated duplicate books. Chapters group under the correct series, the readable source is selected predictably, and rescans update associations without losing progress or metadata.
- **Failure logs:** Common collection, the redacted directory tree, library screenshots before/after rescan, and the affected book title/path values.
- **Blocks V1 release:** **Yes.**

### EV-04: Reader, Bookmarks, and Restart Recovery

- **Prerequisites:** An imported multi-page book from EV-02.
- **Steps:** Open the book; turn pages using keyboard, mouse wheel, and reader controls; test fit width/height/original size, single/double/continuous modes where available, and RTL/LTR direction; create a bookmark; close the app normally; relaunch and reopen the book.
- **Expected result:** Pages decode and turn without sustained UI stalls, controls affect the real image, the bookmark is present, and the last read page/progress restores after restart.
- **Failure logs:** Common collection, reader settings used, page number before exit and after reopening, and any crash/Event Viewer data.
- **Blocks V1 release:** **Yes.**

### EV-05: File Association

- **Prerequisites:** Candidate MSI installed, valid CBZ fixture, and MangaVault fully closed for the first pass.
- **Steps:** Double-click the CBZ in Explorer; confirm the app opens it. Repeat while MangaVault is already running. Check the Explorer Open with entry and icon after Explorer refresh/relogin if required by Windows.
- **Expected result:** The supported file opens in MangaVault, both closed and already-running app cases are handled, and no second unusable instance is left behind.
- **Failure logs:** Common collection, Explorer screenshots, the file extension tested, and any Windows association dialog text.
- **Blocks V1 release:** **Yes.**

### EV-06: In-Place Upgrade

- **Prerequisites:** Install the prior candidate, import a small test library, create a bookmark, change a setting, and close the app. Keep a copy of the test-only data directory before upgrading.
- **Steps:** Run the r9 MSI over the existing installation; launch it; verify the library, settings, bookmark, reading progress, and any existing thumbnails; restart once more.
- **Expected result:** The installer upgrades cleanly. Existing data migrates without reset or duplication, and the app remains launchable after the second start.
- **Failure logs:** Common collection, installer verbose log, pre/post database file listings, and screenshots of missing or duplicated records.
- **Blocks V1 release:** **Yes.**

### EV-07: Uninstall and Reinstall Behavior

- **Prerequisites:** A successfully upgraded or cleanly installed test app with imported test-only content.
- **Steps:** Uninstall from Windows Settings or Apps & Features; verify app shortcuts and association behavior; inspect whether the user-data directory remains; reinstall the same MSI and launch it.
- **Expected result:** Program binaries and shortcuts are removed cleanly. User library data follows the documented retention behavior and is neither silently destroyed nor made unreadable on reinstall.
- **Failure logs:** Common collection, uninstall screen/result, remaining install and app-data directory listings, and installer verbose logs.
- **Blocks V1 release:** **Yes.**

### EV-08: Invalid RAR, 7Z, and PDF Samples

- **Prerequisites:** Installed candidate and the three small invalid/truncated fixtures. Do not use archive-bomb samples or uncontrolled large archives for this batch.
- **Steps:** Import or open each invalid RAR, 7Z, and PDF independently; wait for the reported result; rescan once; confirm the app remains usable afterward.
- **Expected result:** Each failure is reported in the UI with actionable wording. The app does not crash, hang indefinitely, create a partially readable book, alter the source file, or poison later scans.
- **Failure logs:** Common collection, source file name/size/SHA-256, error text, elapsed time, and scan state screenshots.
- **Blocks V1 release:** **Yes.**

### EV-09: WAL, Migration, and Scheduled Restore Recovery

- **Prerequisites:** Isolated test-only app data. Import one small book, create a bookmark, and use Settings to create a database backup. Do not perform this on a personal database.
- **Steps:** Record the pre-restore state; make a visible change such as a tag or bookmark; use Settings to schedule restoration from the known backup; fully exit MangaVault; verify process exit; relaunch. Separately repeat a normal launch with a test copy containing SQLite `-wal`/`-shm` sidecars or an older supported migration state, following the recovery UI rather than manually editing production data.
- **Expected result:** Scheduled restore occurs before normal database use, restores the selected snapshot state, preserves a pre-restore safety copy, and either migrates or presents a recoverable backup path for supported older data. The app must not silently replace a healthy database with an invalid snapshot.
- **Failure logs:** Common collection is mandatory, plus all test-only database siblings, snapshot file names/sizes/hashes, before/after screenshots, and the exact restore/migration path used.
- **Blocks V1 release:** **Yes.**

### EV-10: Installer Presentation and Basic Shell Integration

- **Prerequisites:** A clean test account and the candidate MSI.
- **Steps:** Review product name, version, install location prompts, Start menu shortcut, Add/Remove Programs entry, and first-launch language on both a Chinese Windows display language and an English Windows display language when available.
- **Expected result:** The package identifies itself as MangaVault Desktop, installs to a sensible location, appears in Windows app management, and has no obvious broken/English-only first-launch surface for Chinese users.
- **Failure logs:** Common collection and screenshots of the relevant installer/shell screen.
- **Blocks V1 release:** **No, unless it prevents install, launch, or core discovery.**

## Reporting Format

Report each case as `PASS`, `FAIL`, or `BLOCKED`, followed by the candidate MSI SHA-256, Windows build, fixture type, short reproduction steps, and attached evidence. A failing V1 blocker is triaged as P0/P1 before any next candidate is created. Non-blocking UI/copy observations are added to `STABILIZATION_BACKLOG.md` and grouped into a later stabilization batch.

## Exit Criteria

The batch is accepted when EV-01 through EV-09 pass on the installed MSI, no P0/P1 issue remains open, and EV-10 has no release-blocking installation or shell defect. Until the external result arrives, the codebase is frozen apart from a confirmed P0/P1 fix.
