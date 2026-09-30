# Performance Notes

- Use indexed queries for all library sorting modes.
- Book list calls use `limit` and `offset`; the frontend starts with 240 books, virtualizes rendering, and prefetches the next page near the viewport boundary.
- Do not decode every archive page during scan. Folder image dimensions are cheap; archive dimensions are deferred to read time.
- Keep reader image cache bounded. The current UI preloads two pages behind and ahead and caps retained entries. Thumbnail navigation uses a nearby-window cache rather than loading every page.
- Full-size pages and thumbnails are materialized inside scoped app-cache directories and loaded through Tauri's asset protocol, avoiding Base64 expansion and large IPC string copies.
- Cover requests use a four-worker client queue. Requests that leave the virtualized viewport are cancelled before decoding starts, and reader navigation thumbnails take priority over queued library covers.
- The full-page disk cache is pruned in the background to a 1 GiB budget; original manga files remain outside the webview asset scope.
- Render PDF pages on demand in the Rust backend through bundled Windows Poppler or a platform renderer fallback, then return bounded PNG page payloads to the existing reader cache.
- Duplicate detection runs through indexed book rows and checksum grouping instead of comparing file contents in the UI.
- Use SQLite WAL mode and transaction upserts for scan stability.
- Use the Settings performance maintenance actions to run SQLite `PRAGMA optimize`, `ANALYZE`, and optional `VACUUM` when a large library has changed heavily.
- Keep archive extraction limited to 50 MB per page entry by default.
- Windows production packages carry a verified private 7-Zip console tool for deterministic RAR/7Z support; system tools remain a development fallback.
- Low memory mode and slow query logging are persisted v1.0 settings reserved for future diagnostics and cache-budget tuning.
- Run the 10,000-book SQLite gate with `scripts\cargo-msvc.cmd cargo test benchmarks_ten_thousand_book_library_queries -- --ignored --nocapture` from `src-tauri`. Record the machine, database creation time, deep-page query time, and Chinese substring search time before a release candidate.
- Run the real-library discovery gate without writing to SQLite by setting `MANGAVAULT_SCAN_BENCHMARK_ROOT` and running `scripts\cargo-msvc.cmd cargo test --manifest-path src-tauri\Cargo.toml benchmarks_real_library_discovery --lib -- --ignored --nocapture`. Run the isolated full-import gate with `benchmarks_real_library_import_into_an_isolated_database`; it creates only a temporary SQLite database and never writes the source library. On 2026-07-12, `<sample-library>` produced 270 candidates in 2.57 seconds; the isolated import completed 270 candidates with 0 failures in 20.40 seconds, down from 60.75 seconds before transaction-scoped page and chapter statement reuse.
- Run the queue responsiveness gate with `MANGAVAULT_SCAN_BENCHMARK_ROOT` and `scripts\cargo-msvc.cmd cargo test --manifest-path src-tauri\Cargo.toml benchmarks_real_library_background_queue --lib -- --ignored --nocapture`. It uses a temporary SQLite database and a real `ScanScheduler` worker while a separate foreground connection continuously reads job and library state. On 2026-07-12, the same `sample_library` library queued in 22.9 microseconds, completed 270 imports with 0 failures in 6.01 seconds, and allowed 232 foreground reads while the worker was active.
- Run the real-page cache gate by setting `MANGAVAULT_READER_BENCHMARK_BOOK_PATH` and `MANGAVAULT_READER_BENCHMARK_SOURCE_PATH`, then running `scripts\cargo-msvc.cmd cargo test --manifest-path src-tauri\Cargo.toml benchmarks_real_page_materialization --lib -- --ignored --nocapture`. It materializes into a temporary cache only. On 2026-07-12, one real `waifu2x` WebP page measured 12.14 ms cold and 0.22 ms warm; this is a local-page baseline, not a large-archive or P95 reader claim.
