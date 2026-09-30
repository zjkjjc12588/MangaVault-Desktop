# V1.1-B JMComic Metadata Foundation

Status: implementation checkpoint  
Date: 2026-08-13

## Delivered

- Persists exact JM ID links only after a fresh, token-bound preview and explicit confirmation.
- Keeps external identity, cached source metadata, source tags, and metadata jobs in dedicated tables.
- Provides an opt-in Rust network adapter for the two audited HTTPS endpoints.
- Validates the requested and returned JM ID, encrypted envelope, payload size, field lengths, and response shape.
- Uses TLS verification, disabled redirects, bounded timeouts, a two-request semaphore, per-ID single-flight, and configurable rate limiting.
- Reuses fresh cached metadata and records queued, running, succeeded, and failed jobs.
- Preserves user titles and tags. Provider title/author changes are exposed as a merge preview; source tags remain source-owned.

## Privacy defaults

Online JMComic metadata is disabled by default. Discovery, preview, and identity import do not make network requests. When the user enables online metadata, only an explicit refresh sends the numeric JM ID to the selected allowlisted HTTPS host. Manga images, local paths, reading history, bookmarks, and database contents are not uploaded.

No live request using a user JM ID was made during automated verification. Provider parsing tests use synthetic encrypted responses.

## Data ownership

- `external_book_ids`: confirmed MangaVault book to JM ID relationship.
- `external_book_metadata`: bounded source payload fields and cache expiry.
- `external_book_tags`: tags owned by the JMComic source, separate from user `book_tags`.
- `metadata_jobs`: local audit trail for refresh attempts.
- `metadata_history`: records identity import and continues to identify manual title/author edits.

Refreshing source metadata replaces only JMComic-owned source tags. It does not delete or rewrite user tags, favorites, ratings, progress, bookmarks, pages, or source files.

## Failure behavior

- A stale preview token prevents identity import.
- Conflicting book-to-ID or ID-to-book relationships are reported and left unchanged.
- Disabled networking prevents refresh before any request is made.
- HTTP, timeout, validation, decryption, or database errors mark the job failed and leave existing book metadata intact.
- Responses larger than 2 MiB are rejected while streaming, including responses without `Content-Length`.
- Resetting application preferences disables online metadata but retains confirmed identity links and cached source data.

## Completed in V1.1-C

- Book details source-information UI and explicit per-book refresh controls.
- Unified user/source tag search and category filtering.
- Safe batch enrichment and post-import enrichment after deterministic identity matching.
- Provider status and batch results are user-facing. Detailed job-history diagnostics remain local and are deferred because they are not required for metadata search or normal recovery.
