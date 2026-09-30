# Known Limits

- Windows release installers carry private 7-Zip and Poppler tools for RAR/7Z/CBR and PDF reading. macOS and Linux builds still use a local 7-Zip-compatible binary and Poppler or MuPDF renderer until platform-specific reader tool bundles are delivered.
- The current scanner creates one chapter record per imported book. The database and reader UI support chapter navigation, and finer chapter splitting can be layered onto the scanner later.
- The update-check command exposes the stable application interface, but release transport and signing keys must be configured by a distributor before public auto-updates are enabled.
- Debug bundles are suitable for validation. Production release builds should be signed/notarized per platform before distribution.
