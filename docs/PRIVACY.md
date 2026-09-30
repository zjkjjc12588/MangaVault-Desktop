# Privacy

MangaVault Desktop is offline by default.

Default state:

- AI providers are disabled.
- Sync providers are disabled.
- Telemetry is disabled.
- Plugin execution is disabled.
- Image enhancement and upscale providers are disabled.
- No model files are bundled or downloaded automatically.
- JMComic network metadata is disabled.

Local files:

- Imported manga files remain on the local machine.
- Page images are loaded for local reading and local thumbnail generation.
- MangaVault never sends manga pages, thumbnails, local paths, reading history,
  bookmarks, or database contents to the optional JMComic metadata endpoint.

Optional JMComic metadata:

- Local discovery reads a WAL-consistent snapshot of `download.db` without
  writing to JMComic-qt data or manga source files.
- The user must first confirm exact JM ID links and separately enable online
  metadata.
- Manual refreshes, confirmed batches, and explicitly enabled post-import
  enrichment send only the linked numeric JM ID to an allowlisted HTTPS host.
- TLS verification, timeout, redirect, response-size, and field-size checks are
  enforced. Credentials and JMComic configuration files are not read.

Telemetry:

- The v1.0 telemetry interface is a disabled setting and service boundary.
- No diagnostics are sent from the default application.
- Telemetry settings are also represented in SQLite so the settings page can
  show the consent state without relying on hard-coded UI text.

License state:

- The default license state is `community`.
- License support is an offline interface boundary in v1.0; no license server is
  contacted by default.

External commands:

- Local CLI providers are user-configured.
- Commands are spawned through argument arrays, not shell strings.
- Input paths, output directories, timeouts, stdout, and stderr are validated or
  captured before returning structured results.
- Upscale cache cleanup deletes files only inside MangaVault's application cache
  root and never removes original manga files.
