# MangaVault Desktop 1.1.0 RC1

V1.1 RC1 adds the approved JMComic metadata workflow to the stable V1.0 desktop reader. It is a Windows x64 external-validation build, not the final V1.1 release.

## Highlights

- Read-only discovery of JMComic-qt `download.db` with WAL-consistent snapshots and schema health checks.
- Exact logical-root matching between existing or newly imported MangaVault books and numeric JM IDs.
- Explicit preview and confirmation before identity links are saved.
- Optional source title, author, tags, categories, description, cover URL, and chapter metadata.
- Search by JM ID and source metadata; filter by source or user tags and source categories.
- Separate source information in the metadata dialog, with explicit adoption of source title or author.
- Optional post-import enrichment and cancellable batch enrichment with fresh-cache skipping.

## Safety And Privacy

JMComic networking is disabled by default. Enabling it permits only the selected manual, batch, or post-import operations to send a confirmed numeric JM ID to an allowlisted HTTPS endpoint. Manga pages, local paths, database contents, reading history, bookmarks, and credentials are not uploaded.

MangaVault never writes to JMComic-qt databases and never modifies source manga files. Provider metadata is source-owned and cannot silently replace user titles or user tags. Failed requests leave existing metadata and all reading data intact.

## Upgrade

The MSI keeps the existing UpgradeCode and is intended to upgrade MangaVault 1.0.0 while preserving the application database, libraries, progress, bookmarks, shortcuts, settings, and recent history. Migration 10 adds source-category indexing and V1.1 bridge settings. Back up application data before installing an RC on an important library.

## Known Limits

- This compatibility provider depends on an undocumented third-party endpoint and may require future maintenance.
- Ambiguous, moved, or missing source paths are not linked automatically.
- Real endpoint behavior, large real batches, future-import enrichment, and upgrade installation require Windows external validation.
- The package is unsigned and may show an unknown-publisher warning.
