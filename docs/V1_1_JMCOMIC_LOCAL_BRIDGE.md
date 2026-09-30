# V1.1-A JMComic Local Bridge

Status: implementation checkpoint  
Date: 2026-08-13

## Scope

V1.1-A establishes a read-only bridge between JMComic download history and MangaVault books. It discovers `download.db`, copies a WAL-consistent SQLite snapshot into memory, validates the expected schema and `quick_check`, then matches records by normalized logical work root.

This batch does not:

- write JM IDs, titles, or tags to MangaVault;
- modify JMComic databases or downloaded files;
- contact a JM service or any other network endpoint;
- infer identity from similar titles.

## Validation

Automated tests exercise exact logical-root matches, unmatched records, missing
source paths, schema validation, and bounded discovery. Unmatched records remain
unassociated, and no title-based fallback is attempted. Private download history,
source paths, and user collection statistics are excluded from this repository.

## Matching rules

1. Read `bookId`, `title`, `savePath`, and `convertPath` from the snapshot.
2. Normalize slash direction and Windows long-path prefixes for comparison only.
3. Collapse `original` and `waifu2x` to the parent logical work root.
4. Match that root to an available MangaVault book path.
5. Accept exactly one matching book; report zero or multiple matches without guessing.

The database and UI continue to retain their original path strings. Matching does not rename folders, rewrite paths, or use page/episode names as book titles.

## Safety and performance

- JMComic SQLite opens with `SQLITE_OPEN_READ_ONLY`.
- SQLite Online Backup creates an in-memory consistent snapshot before querying.
- Sources larger than 512 MiB are rejected.
- Registered MangaVault library roots are excluded from discovery walks so page collections do not consume the search budget.
- Discovery is explicit, runs on a background thread, has bounded depth and entry counts, and skips common system/build/cache trees.
- Concurrent discovery requests share one single-flight task and reuse its result for the application session.
- The settings UI exposes only discovery, manual database selection, and read-only preview.

## Next checkpoint

V1.1-B now provides explicit, token-bound identity import and the opt-in metadata foundation described in `V1_1_JMCOMIC_METADATA_FOUNDATION.md`. V1.1-A itself remains read-only: merely discovering or previewing matches still performs no MangaVault write and no network request.
