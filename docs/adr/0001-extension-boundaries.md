# ADR 0001: Extension Boundaries

## Status

Accepted for v1.0.

## Context

MangaVault needs long-term extension points for plugins, AI providers, OCR,
translation, sync, image enhancement, and local CLI tools, while the current
reader must remain fast and fully offline.

## Decision

Core reader, scanner, and library management stay independent from optional
providers. Providers are introduced through interfaces and additive SQLite
tables. Advanced features are disabled by default and require explicit settings
or provider registration.

External commands are executed only through process argument arrays. MangaVault
does not build shell command strings.

## Consequences

The v1.0 codebase gains stable contracts and schema room for future work without
binding the reader to any model, cloud service, or plugin runtime.
