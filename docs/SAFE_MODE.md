# Safe Mode Strategy

Safe mode is the recovery posture for startup, database, provider, or cache
failures.

v1.0 behavior:

- Database quick-check can create backups before recovery work.
- Scan failures are recorded in scan jobs and do not delete imported books.
- Extension providers are disabled by default and are not required for reading.
- Upscale failures return the original page path as the usable fallback.

Future safe mode startup policy:

- Start without optional providers.
- Skip automatic sync, AI, plugin, and external process execution.
- Keep library browsing and reader access available when the database passes
  quick-check.
- Offer database backup, cache rebuild, thumbnail rebuild, and settings reset
  actions from reliability settings.

Operational rule:

- Recovery actions must not delete local manga files.
