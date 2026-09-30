# MangaVault V1.1 Delivery Backlog

V1.1 is active under the user-approved JMComic metadata scope. MangaVault 1.0.x remains frozen except for P0/P1 maintenance.

## Approved Batches

- **V1.1-A Local bridge (checkpoint complete):** discover JMComic `download.db`, read a consistent read-only snapshot, validate its schema, and preview exact logical-root matches to JM IDs.
- **V1.1-B Metadata foundation (checkpoint complete):** traceable external identities and source-owned metadata, an opt-in JM provider, cache/rate-limit/background jobs, merge previews, and user-edit precedence.
- **V1.1-C Reader-facing metadata (implementation complete):** source information, unified tag/category search and filtering, deterministic post-import linking, optional enrichment, and token-bound batch controls.
- **Release (external validation):** full automated gates passed and one Windows external-validation MSI was generated. Source changes are frozen pending real Windows results.

## Deferred

- Ordinary UX enhancements unrelated to metadata discovery
- Additional reader preferences
- OCR, translation, cloud sync, plugins, AI, or a general provider platform
- Official macOS/Linux packaging

No network provider is enabled by default. JMComic databases and manga source files are never modified. Every metadata write requires source ownership, audit history, user-edit protection, and a tested rollback path.
