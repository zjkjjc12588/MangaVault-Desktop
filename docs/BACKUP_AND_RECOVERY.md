# Backup And Recovery

## What MangaVault Stores

MangaVault stores library roots, indexed books and pages, metadata, tags, ratings, favorites, reading progress, bookmarks, recent history, settings, shortcut bindings, and backup records in its SQLite application database.

The database is stored under the Windows user profile in `%APPDATA%\com.mangavault.desktop`. Generated caches and logs are stored separately under the application cache and local data locations. Source comics remain in the folders selected by the user.

## Create A Backup

1. Open **Settings**.
2. Select **Backup & Local Data**.
3. Check that database health is OK.
4. Choose **Back up database**.
5. Keep the reported snapshot path with your normal backup set.

The backup uses SQLite's backup API so WAL content is captured consistently. MangaVault runs `quick_check` and registers only healthy managed snapshots.

Backups do not include source comic files. Back up those folders separately.

## Restore A Managed Backup

1. Open **Settings > Backup & Local Data**.
2. Select a healthy managed snapshot.
3. Confirm **Restore on restart**.
4. Close and start MangaVault again.

Before opening SQLite, MangaVault creates a `pre-restore` safety snapshot of the current database and its relevant state. If preparation fails, the live database is kept.

You can cancel a scheduled restore before restarting.

## Start With An Empty Database

The high-risk reset action is collapsed under **Backup & Local Data**. It requires two confirmations and first creates and validates a WAL-consistent backup. Reset preparation is refused while a scan is active or when the backup is unhealthy.

After restart, MangaVault archives the old database and creates a new empty database. The operation does not delete source comics or independent backups. If replacement fails, the old database is restored.

## Automatic Recovery Snapshots

- `pre-migration`: created before schema changes are applied to an existing database.
- `pre-restore`: created before a scheduled restore replaces the live database.
- `pre-reset`: created before starting over with an empty database.
- corruption recovery: preserves the damaged database and attempts to restore the newest healthy managed snapshot.

## Recovery Rules

- Do not copy or replace the live database while MangaVault is running.
- Do not separate a database from its active `-wal` and `-shm` files during manual recovery.
- Prefer the in-app restore workflow over manual file replacement.
- Keep the latest application logs from `%LOCALAPPDATA%\com.mangavault.desktop\logs` when reporting a failure.
- Never delete source comics while diagnosing a database problem.

If no healthy managed snapshot exists, preserve the entire application data directory before attempting manual recovery.
