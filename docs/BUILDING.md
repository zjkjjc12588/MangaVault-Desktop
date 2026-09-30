# Building On Each Platform

## Windows

Install Node.js 22, Rust stable, Microsoft C++ Build Tools, and WebView2. Then run:

```powershell
npm install
npx playwright install chromium
npm run release:windows
```

If `cargo` reports that `link.exe` is missing, install Visual Studio Build Tools with the C++ workload and Windows SDK. This repository includes `scripts\cargo-msvc.cmd`, which loads the Build Tools environment before running a command:

```powershell
scripts\cargo-msvc.cmd cargo test --manifest-path src-tauri\Cargo.toml
npm run tauri:dev:msvc
```

The Windows release command downloads verified, application-private 7-Zip and
Poppler tools before bundling. It does not install either tool system-wide:

```powershell
npm run release:windows
```

For development, system `pdftoppm`/`mutool` and a 7-Zip compatible binary are
accepted as fallbacks.

## macOS

Install Xcode Command Line Tools, Node.js 22, and Rust stable.

```bash
npm install
npx playwright install chromium
npm run tauri build
```

Install Poppler or MuPDF when PDF reading should be available in packaged builds.

## Linux

Install WebKitGTK 4.1, Ayatana AppIndicator, Rust stable, and Node.js 22.

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
npm install
npx playwright install chromium
npm run tauri build
```

Install `poppler-utils` or `mupdf-tools` for PDF reading, and `p7zip-full` or `7zip` for RAR/7Z/CBR extraction.
