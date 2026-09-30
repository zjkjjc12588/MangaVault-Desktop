# MangaVault Desktop Maintenance Roadmap

MangaVault Desktop 1.0.0 is feature-frozen. The former broad long-term expansion goal remains paused. V1.1 development is active only for the explicitly approved JMComic metadata and tag discovery scope.

## 1.0.x Maintenance

Only P0/P1 work is accepted:

- Installation or startup failure
- Data corruption, unintended deletion, or failed recovery
- Serious security vulnerability
- Core import, scan, title, page order, reader, progress, bookmark, fullscreen, shortcut, settings-save, or Recent Reading failure
- Clear regression introduced by V1.0.0
- Severe performance or memory issue that makes a core workflow unusable

Ordinary copy, styling, preference, and UX suggestions are recorded without changing V1.0.x.

## 1.1 External Validation

V1.1 RC1 delivers a read-only JMComic local bridge, traceable external identities, optional network metadata enrichment, and source-aware tag search. Automated quality gates are complete; changes are frozen while Windows external validation confirms real endpoint, upgrade, and future-import behavior.

All unrelated UX requests, reader options, AI/OCR, sync, plugins, and general provider-platform work remain deferred.

V1.0.0 does not include OCR, translation, cloud sync, a plugin marketplace, a general AI platform, or official macOS/Linux binaries.

## Process

- P0/P1 reports enter `V1_HOTFIX_BACKLOG.md` after reproduction and severity confirmation.
- P2/P3 suggestions enter `USER_FEEDBACK.md` or `V1_1_BACKLOG.md`.
- No maintenance item restores the original long-term goal automatically.
