INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
  ('appearance.theme', '"system"', datetime('now')),
  ('reader.mode', '"single"', datetime('now')),
  ('reader.direction', '"ltr"', datetime('now')),
  ('reader.fit', '"width"', datetime('now')),
  ('reader.zoom', '100', datetime('now')),
  ('reader.background', '"#0b0f14"', datetime('now')),
  ('reader.brightness', '100', datetime('now')),
  ('reader.contrast', '100', datetime('now')),
  ('reader.saturation', '100', datetime('now')),
  ('reader.rotation', '0', datetime('now')),
  ('reader.grayscale', 'false', datetime('now')),
  ('reader.sharpen', 'false', datetime('now')),
  ('reader.trim_white', 'false', datetime('now')),
  ('reader.night', 'false', datetime('now')),
  ('scanner.max_extract_bytes', '52428800', datetime('now')),
  ('scanner.recursive', 'true', datetime('now')),
  ('cache.thumbnail_limit_mb', '2048', datetime('now')),
  ('features.plugins.enabled', 'false', datetime('now')),
  ('features.ai.enabled', 'false', datetime('now')),
  ('features.sync.enabled', 'false', datetime('now')),
  ('features.ocr.enabled', 'false', datetime('now')),
  ('features.translation.enabled', 'false', datetime('now')),
  ('features.telemetry.enabled', 'false', datetime('now')),
  ('features.developer.enabled', 'false', datetime('now')),
  ('developer.command_debugger.enabled', 'false', datetime('now')),
  ('developer.profiler.enabled', 'false', datetime('now')),
  ('developer.database_browser.enabled', 'false', datetime('now')),
  ('sync.provider_id', 'null', datetime('now')),
  ('sync.automatic_enabled', 'false', datetime('now')),
  ('sync.encryption_required', 'true', datetime('now')),
  ('sync.conflict_strategy', '"manual"', datetime('now')),
  ('sync.allowed_items', '["progress","bookmarks","tags","favorites","settings","metadata"]', datetime('now')),
  ('performance.low_memory', 'false', datetime('now')),
  ('performance.slow_query_log', 'false', datetime('now')),
  ('performance.reader_priority_preload', 'true', datetime('now')),
  ('ui.theme_preset_id', '"mangavault.dark"', datetime('now')),
  ('ui.layout.sidebar_mode', '"expanded"', datetime('now')),
  ('ui.layout.grid_density', '"comfortable"', datetime('now')),
  ('ui.layout.cover_aspect_ratio', '"portrait"', datetime('now')),
  ('ui.command_palette.enabled', 'true', datetime('now')),
  ('ui.shortcuts.custom_enabled', 'false', datetime('now')),
  ('ui.navigation.pinned', '["nav.library","nav.reader","nav.settings"]', datetime('now')),
  ('ocr.provider_id', 'null', datetime('now')),
  ('ocr.default_locale', '"ja"', datetime('now')),
  ('ocr.cache.enabled', 'true', datetime('now')),
  ('translation.provider_id', 'null', datetime('now')),
  ('translation.source_locale', '"ja"', datetime('now')),
  ('translation.target_locale', '"zh-CN"', datetime('now')),
  ('translation.cache.enabled', 'true', datetime('now')),
  ('translation.overlay.enabled', 'false', datetime('now')),
  ('upscale.enabled', 'false', datetime('now')),
  ('upscale.provider_id', 'null', datetime('now')),
  ('upscale.local_cli.executable_path', '""', datetime('now')),
  ('upscale.local_cli.arguments_template', '"--input {input} --output {output} --scale {scale} --model {model} --device {device} --format {format} --quality {quality}"', datetime('now')),
  ('upscale.model_path', '""', datetime('now')),
  ('upscale.device', '"auto"', datetime('now')),
  ('upscale.default_scale', '2', datetime('now')),
  ('upscale.output_format', '"webp"', datetime('now')),
  ('upscale.output_quality', '90', datetime('now')),
  ('upscale.cache_limit_mb', '2048', datetime('now')),
  ('upscale.realtime_in_reader', 'false', datetime('now')),
  ('upscale.background_precompute', 'false', datetime('now')),
  ('metadata.jmcomic.enabled', 'false', datetime('now')),
  ('metadata.jmcomic.endpoint', '"https://www.cdngwc.cc"', datetime('now')),
  ('metadata.jmcomic.refresh_days', '30', datetime('now')),
  ('metadata.jmcomic.request_interval_ms', '1200', datetime('now')),
  ('metadata.jmcomic.auto_enrich', '"off"', datetime('now')),
  ('metadata.jmcomic.database_path', 'null', datetime('now')),
  ('metadata.jmcomic.auto_link', 'false', datetime('now')),
  ('locale', '"zh-CN"', datetime('now'));

INSERT OR IGNORE INTO tags(name, color, created_at) VALUES
  ('未读', '#475569', datetime('now')),
  ('收藏', '#f59e0b', datetime('now')),
  ('已完结', '#10b981', datetime('now'));

INSERT OR IGNORE INTO reader_profiles(
  profile_id, name, mode, direction, fit, settings_json, created_at, updated_at
) VALUES
  (
    'global.default',
    '默认阅读配置',
    'single',
    'ltr',
    'width',
    '{"zoom":100,"trimWhite":false,"night":false}',
    datetime('now'),
    datetime('now')
  ),
  (
    'manga.rtl.double',
    '日漫右到左双页',
    'double',
    'rtl',
    'width',
    '{"zoom":100,"coverAlignment":"right","trimWhite":false}',
    datetime('now'),
    datetime('now')
  ),
  (
    'webtoon.scroll',
    '条漫连续滚动',
    'scroll',
    'ltr',
    'width',
    '{"zoom":100,"continuous":true,"trimWhite":true}',
    datetime('now'),
    datetime('now')
  );

INSERT OR IGNORE INTO feature_flags(key, enabled, created_at, updated_at) VALUES
  ('plugins.enabled', 0, datetime('now'), datetime('now')),
  ('ai.enabled', 0, datetime('now'), datetime('now')),
  ('sync.enabled', 0, datetime('now'), datetime('now')),
  ('ocr.enabled', 0, datetime('now'), datetime('now')),
  ('translation.enabled', 0, datetime('now'), datetime('now')),
  ('telemetry.enabled', 0, datetime('now'), datetime('now')),
  ('developer.enabled', 0, datetime('now'), datetime('now')),
  ('upscale.enabled', 0, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO telemetry_settings(key, enabled, value, created_at, updated_at) VALUES
  ('anonymous_diagnostics', 0, 'false', datetime('now'), datetime('now')),
  ('crash_reports', 0, 'false', datetime('now'), datetime('now')),
  ('usage_metrics', 0, 'false', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO license_state(id, license_key, status, metadata_json, created_at, updated_at)
VALUES (1, NULL, 'community', '{"offline":true,"proFeaturesEnabled":false}', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO smart_collections(name, query_json, enabled, created_at, updated_at) VALUES
  ('未读', '{"progress":"unread","sort":"title"}', 1, datetime('now'), datetime('now')),
  ('收藏', '{"favorite":true,"sort":"title"}', 1, datetime('now'), datetime('now')),
  ('最近阅读', '{"sort":"recent"}', 1, datetime('now'), datetime('now')),
  ('高评分', '{"minRating":4,"sort":"rating"}', 1, datetime('now'), datetime('now'));
