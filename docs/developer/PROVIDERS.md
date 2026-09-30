# Provider Development Notes

Providers are optional extension adapters. A provider must not be required for
library scanning, normal reading, or local metadata editing.

Provider categories reserved in v1.0:

- Metadata providers.
- AI providers.
- Upscale providers.
- OCR providers.
- Translation providers.
- Sync providers.
- Image pipeline providers.

Local CLI upscale providers:

- Require a user-configured executable path.
- Require an argument template with supported placeholders:
  `{input}`, `{output}`, `{scale}`, `{model}`, `{device}`, `{format}`,
  `{quality}`.
- Must validate the input file and output directory before execution.
- Must use process spawn arguments, not shell command strings.
- Must return structured stdout, stderr, timeout, exit code, and fallback
  information.

Provider failure policy:

- Failure must not block the reader.
- The original page remains the fallback for image enhancement failures.
- Cache cleanup must be available before persistent cache is enabled by default.

Metadata providers:

- Filename parsing is available through the metadata parser boundary.
- ComicInfo.xml parse/export helpers support common fields: title, series,
  number, volume, writer, language, year, and comma-separated tags.
- v1.0 does not automatically modify archive contents; future import/export UI
  should route through the metadata history tables.
