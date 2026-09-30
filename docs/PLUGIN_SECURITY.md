# Plugin Security Policy

MangaVault v1.0 reserves plugin metadata and registry interfaces but does not
execute plugin code.

Allowed in v1.0:

- Reading a plugin manifest.
- Validating plugin id, name, version, permissions, and contributions.
- Persisting disabled or enabled state.
- Showing extension settings.

Not allowed in v1.0:

- Dynamic JavaScript, WebAssembly, native library, or script execution.
- Shell-based command construction.
- Automatic marketplace downloads.
- File upload by a plugin.

Permission principles:

- Plugins start disabled.
- Permissions must be declared in the manifest.
- External process permission is separate from metadata or UI contribution
  permissions.
- Cloud access requires a future explicit user consent flow.

Local file policy:

- MangaVault never gives a plugin implicit access to all library files.
- Future plugin APIs must pass canonicalized paths and scoped handles.
