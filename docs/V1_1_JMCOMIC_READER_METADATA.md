# V1.1 JMComic Metadata Guide

Status: V1.1 RC1 external validation  
Date: 2026-08-13

## What It Does

MangaVault can associate a local book with the numeric JM ID recorded by JMComic-qt, fetch optional source metadata, and use the resulting tags and categories in library search and filters. Local manga importing and reading remain available with networking disabled.

The integration has two separate consent steps:

1. MangaVault reads a WAL-consistent, read-only snapshot of JMComic-qt `download.db`, previews exact logical-root matches, and imports only the confirmed JM ID links.
2. The user separately enables online metadata. Only then may a manual refresh, a confirmed batch, or an enabled post-import refresh contact the selected HTTPS endpoint.

## Initial Setup

1. Open **Settings > Library > JMComic metadata source**.
2. Select **Auto discover**, or choose the JMComic-qt `download.db` manually.
3. Select **Preview links** and review matched, unmatched, missing, and ambiguous records.
4. Import the exact matches. This stores JM ID and canonical source path in MangaVault only.
5. Enable **Allow online JMComic metadata** if source tags and descriptions are wanted.
6. Use **Preview batch enrichment**, then confirm the displayed count.

The discovered database path is remembered after a confirmed identity import. Later scans reconcile newly imported MangaVault books against a fresh read-only snapshot. With **Metadata after import** set to **Enrich after an exact JM ID match**, newly linked books are enriched in one bounded background job. A missing database or failed network request does not fail the local scan.

## Search And Classification

The Library search box matches local title/author/path plus confirmed JM ID, source title, source author, source tags, and source categories. The tag filter includes both user tags and source tags. **Source category** filters only source-owned categories.

User and source ownership remain separate:

- User tags stay in MangaVault's normal tag tables and are never removed by a provider refresh.
- JMComic tags and categories are replaced only within the JMComic-owned source tables.
- Source title and author are shown separately in book metadata. Selecting **Use this value** fills the editable field; the user still saves the edit explicitly.
- Favorites, ratings, progress, bookmarks, pages, source paths, and source files are not changed by enrichment.

## Network And Privacy

- Online metadata is disabled by default.
- Enabled requests send the confirmed numeric JM ID to the selected allowlisted HTTPS host.
- Manga images, local paths, library database contents, reading history, bookmarks, and credentials are not uploaded.
- TLS certificate verification remains enabled; redirects and non-allowlisted hosts are rejected.
- Responses have timeout, size, identity, and field-length limits.
- Fresh cached metadata is used until its configured expiry.

This is a compatibility integration, not an official partnership or a documented stable public API. Endpoint behavior may change. Provider failures preserve the last good cache and never prevent local reading.

## Recovery

Stop a running batch with **Stop batch**. Cancellation takes effect between requests. Re-run **Preview batch enrichment** to skip fresh cache entries and retry missing or stale entries. Resetting preferences disables networking but retains confirmed JM ID links and cached source data. Normal database backup and recovery includes the V1.1 source tables.

## Current Limits

- Identity association is deliberately restricted to deterministic logical-root path matches; title guessing is not used.
- Ambiguous, moved, or missing paths require manual review and are not silently linked.
- Detailed provider job history remains diagnostic data rather than a normal settings page.
- No live user JM request is made by automated tests; real endpoint compatibility is part of Windows external validation.
