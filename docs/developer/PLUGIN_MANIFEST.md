# Plugin Manifest

MangaVault v1.0 supports manifest validation and settings storage only. It does
not execute plugin code.

Example:

```json
{
  "id": "local.metadata.example",
  "name": "Local Metadata Example",
  "version": "1.0.0",
  "permissions": ["ReadMetadata"],
  "contributions": [
    {
      "kind": "metadataProvider",
      "target": "library"
    }
  ]
}
```

Manifest rules:

- `id` may contain ASCII letters, numbers, dots, dashes, and underscores.
- `name` and `version` are required.
- Permissions must be explicit.
- Contributions describe future extension points; they are not executed in v1.0.
