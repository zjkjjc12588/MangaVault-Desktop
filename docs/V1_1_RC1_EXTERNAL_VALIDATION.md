# MangaVault Desktop V1.1 RC1 External Validation

Use `PASS`, `FAIL`, or `BLOCKED`. Record screenshots and logs for every failure. Do not include manga images or private paths in shared logs unless intentionally redacted.

## Install And Upgrade

| Check                                                                                                  | Status | Notes / screenshot / log |
| ------------------------------------------------------------------------------------------------------ | ------ | ------------------------ |
| Upgrade from V1.0.0 preserves libraries, progress, bookmarks, settings, shortcuts, and recent history. |        |                          |
| A clean Windows account starts with networking disabled and no private JMComic path.                   |        |                          |
| Application starts without a console window or development server.                                     |        |                          |
| Application data remains under the Windows user profile, not the installation directory.               |        |                          |

## Local JMComic Bridge

| Check                                                                                                       | Status | Notes / screenshot / log |
| ----------------------------------------------------------------------------------------------------------- | ------ | ------------------------ |
| Auto discovery finds the intended `download.db`, or manual selection works.                                 |        |                          |
| Preview is read-only and reports matched, unmatched, missing, and ambiguous records accurately.             |        |                          |
| Exact matches correspond to the logical work root, not `original`, `waifu2x`, chapter, or page directories. |        |                          |
| Importing links does not modify the JMComic database or source files.                                       |        |                          |
| Repeating preview/import is idempotent and reports existing links rather than duplicates.                   |        |                          |

## Metadata Fetch And Ownership

| Check                                                                                                  | Status | Notes / screenshot / log |
| ------------------------------------------------------------------------------------------------------ | ------ | ------------------------ |
| With networking disabled, refresh and batch actions cannot make a request.                             |        |                          |
| A confirmed JM ID refresh returns the correct source title, author, tags, categories, and description. |        |                          |
| Source information is visibly separate from user metadata.                                             |        |                          |
| Refresh does not overwrite a manually edited title, author, or user tag.                               |        |                          |
| **Use this value** changes only the editable field until the user saves.                               |        |                          |
| A failed or timed-out request leaves the last good cache and reading data intact.                      |        |                          |
| Changing the cache period causes fresh entries to be skipped as expected.                              |        |                          |

## Search And Classification

| Check                                                                                             | Status | Notes / screenshot / log |
| ------------------------------------------------------------------------------------------------- | ------ | ------------------------ |
| Search by numeric JM ID finds the associated book.                                                |        |                          |
| Search by source title, source author, source tag, and source category finds the associated book. |        |                          |
| Tag filter includes source and user tags without merging their ownership in metadata editing.     |        |                          |
| Source category filter returns the correct works.                                                 |        |                          |
| Grid, list, cover wall, search, and metadata details refer to the same book and title.            |        |                          |

## Future Imports And Batch

| Check                                                                                                        | Status | Notes / screenshot / log |
| ------------------------------------------------------------------------------------------------------------ | ------ | ------------------------ |
| Download a new work in JMComic-qt, import or rescan it in MangaVault, and confirm the exact JM ID is linked. |        |                          |
| Manual-only mode links the ID without making an automatic network request.                                   |        |                          |
| Post-import enrichment mode fetches metadata after an exact match without blocking the scan UI.              |        |                          |
| A missing or locked JMComic database does not fail the MangaVault scan.                                      |        |                          |
| Batch preview reports eligible and fresh-cache counts before execution.                                      |        |                          |
| Two simultaneous batch starts do not create duplicate running batches.                                       |        |                          |
| Stop batch halts between requests; a new preview safely resumes remaining work.                              |        |                          |
| Large batch activity remains responsive and does not create a process or task storm.                         |        |                          |

## Evidence

- Application logs: `%LOCALAPPDATA%` MangaVault log directory
- Installer log: `msiexec /i "MangaVault-1.1.0-rc.1-x64.msi" /L*V "%TEMP%\MangaVault-1.1.0-rc.1-install.log"`
- Record endpoint errors without sharing credentials or private comic paths.
