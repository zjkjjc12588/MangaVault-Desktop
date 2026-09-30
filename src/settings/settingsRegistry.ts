import {
  BookOpen,
  Database,
  HardDrive,
  Image,
  Info,
  Keyboard,
  Library,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { Locale } from "../lib/i18n";

export type SettingsSectionId =
  | "general"
  | "library"
  | "reader"
  | "display"
  | "input"
  | "storage"
  | "data"
  | "advanced"
  | "about";

interface LocalizedText {
  zh: string;
  en: string;
}

export interface SettingsSectionDefinition {
  sectionId: SettingsSectionId;
  title: LocalizedText;
  description: LocalizedText;
  icon: LucideIcon;
  keywords: string[];
  searchAliases: string[];
  order: number;
  componentId: string;
  isAdvanced: boolean;
  restoreDefaults: Record<string, unknown>;
}

export interface SettingsItemDefinition {
  settingId: string;
  sectionId: SettingsSectionId;
  title: LocalizedText;
  description: LocalizedText;
  keywords: string[];
  aliases: string[];
  focusTarget: string;
}

export interface SettingsSearchResult {
  settingId: string;
  sectionId: SettingsSectionId;
  title: string;
  sectionTitle: string;
  description: string;
  focusTarget: string;
  score: number;
}

const section = (
  sectionId: SettingsSectionId,
  title: LocalizedText,
  description: LocalizedText,
  icon: LucideIcon,
  order: number,
  restoreDefaults: Record<string, unknown>,
  isAdvanced = false,
): SettingsSectionDefinition => ({
  sectionId,
  title,
  description,
  icon,
  keywords: [title.zh, title.en],
  searchAliases: [],
  order,
  componentId: `${sectionId}-settings`,
  isAdvanced,
  restoreDefaults,
});

export const settingsSections: SettingsSectionDefinition[] = [
  section(
    "general",
    localized("常规", "General"),
    localized("语言、主题和应用界面偏好", "Language, theme, and app interface preferences"),
    Settings,
    10,
    {
      locale: "zh-CN",
      "appearance.theme": "system",
      "ui.layout.sidebar_mode": "expanded",
      "ui.command_palette.enabled": true,
    },
  ),
  section(
    "library",
    localized("漫画库", "Library"),
    localized("浏览方式、漫画目录和扫描", "Browsing, manga folders, and scanning"),
    Library,
    20,
    {
      "ui.layout.grid_density": "comfortable",
      "ui.layout.cover_aspect_ratio": "portrait",
      "library.open_mouse_action": "double",
      "scanner.recursive": true,
    },
  ),
  section(
    "reader",
    localized("阅读器", "Reader"),
    localized("默认阅读方式和阅读界面", "Default reading behavior and reader interface"),
    BookOpen,
    30,
    {
      "reader.mode": "single",
      "reader.direction": "ltr",
      "reader.fit": "width",
      "reader.launch_state": "windowed",
      "reader.controls_layout": "auto",
    },
  ),
  section(
    "display",
    localized("显示与图像", "Display & Image"),
    localized("漫画画面和阅读背景默认值", "Default page appearance and reading background"),
    Image,
    40,
    {
      "reader.brightness": 100,
      "reader.contrast": 100,
      "reader.saturation": 100,
      "reader.grayscale": false,
      "reader.sharpen": false,
      "reader.trim_white": false,
      "reader.rotation": 0,
      "reader.background": "#0b0f14",
    },
  ),
  section(
    "input",
    localized("键盘与鼠标", "Keyboard & Mouse"),
    localized("快捷键和阅读手势", "Shortcuts and reading gestures"),
    Keyboard,
    50,
    {},
  ),
  section(
    "storage",
    localized("存储与缓存", "Storage & Cache"),
    localized("内存、缓存和数据库维护", "Memory, cache, and database maintenance"),
    HardDrive,
    60,
    { "performance.low_memory": false, "cache.thumbnail_limit_mb": 2048 },
  ),
  section(
    "data",
    localized("备份与本地数据", "Backup & Local Data"),
    localized(
      "数据库健康、备份、恢复和数据位置",
      "Database health, backup, recovery, and location",
    ),
    Database,
    70,
    {},
  ),
  section(
    "advanced",
    localized("高级与诊断", "Advanced & Diagnostics"),
    localized("日志、格式能力和开发诊断", "Logs, format capabilities, and developer diagnostics"),
    SlidersHorizontal,
    80,
    {},
    true,
  ),
  section(
    "about",
    localized("关于", "About"),
    localized("版本、隐私和产品信息", "Version, privacy, and product information"),
    Info,
    90,
    {},
  ),
];

const item = (
  settingId: string,
  sectionId: SettingsSectionId,
  zhTitle: string,
  enTitle: string,
  zhDescription: string,
  enDescription: string,
  aliases: string[] = [],
): SettingsItemDefinition => ({
  settingId,
  sectionId,
  title: localized(zhTitle, enTitle),
  description: localized(zhDescription, enDescription),
  keywords: [zhTitle, enTitle, zhDescription, enDescription],
  aliases,
  focusTarget: `setting-${settingId.replaceAll(".", "-")}`,
});

export const settingsItems: SettingsItemDefinition[] = [
  item(
    "appearance.theme",
    "general",
    "主题",
    "Theme",
    "浅色、深色或跟随系统",
    "Light, dark, or system theme",
    ["外观"],
  ),
  item("locale", "general", "语言", "Language", "界面显示语言", "Interface language", [
    "中文",
    "English",
  ]),
  item(
    "ui.layout.sidebar_mode",
    "general",
    "主侧栏",
    "Main sidebar",
    "展开或折叠主导航",
    "Expand or collapse main navigation",
    ["折叠", "导航"],
  ),
  item(
    "ui.command_palette.enabled",
    "general",
    "快速操作",
    "Quick actions",
    "启用本地命令面板",
    "Enable the local command palette",
    ["命令面板", "Ctrl K"],
  ),
  item(
    "ui.layout.grid_density",
    "library",
    "网格密度",
    "Grid density",
    "调整漫画卡片密度",
    "Adjust manga card density",
  ),
  item(
    "ui.layout.cover_aspect_ratio",
    "library",
    "封面比例",
    "Cover ratio",
    "调整漫画封面显示比例",
    "Adjust cover display ratio",
  ),
  item(
    "library.open_mouse_action",
    "library",
    "打开漫画的鼠标操作",
    "Mouse action to open manga",
    "单击或双击打开漫画",
    "Open manga with a single or double click",
    ["双击", "单击"],
  ),
  item(
    "library.folders",
    "library",
    "漫画库位置",
    "Manga folders",
    "添加和管理多个漫画目录",
    "Add and manage multiple manga folders",
    ["目录", "扫描", "文件夹"],
  ),
  item(
    "library.formats",
    "library",
    "支持格式",
    "Supported formats",
    "本地归档和 PDF 工具状态",
    "Local archive and PDF tool status",
    ["7z", "rar", "pdf"],
  ),
  item(
    "library.jmcomic",
    "library",
    "JMComic 元数据来源",
    "JMComic metadata source",
    "发现 JMComic 下载数据库并预览 JM ID 路径关联",
    "Discover the JMComic download database and preview JM ID path matches",
    ["JM号", "JM ID", "标签", "tag", "download.db"],
  ),
  item(
    "reader.mode",
    "reader",
    "默认阅读方式",
    "Default reading mode",
    "单页、双页或连续滚动",
    "Single, double, or continuous scroll",
  ),
  item(
    "reader.direction",
    "reader",
    "阅读方向",
    "Reading direction",
    "从左到右或从右到左",
    "Left-to-right or right-to-left",
    ["RTL", "LTR"],
  ),
  item(
    "reader.fit",
    "reader",
    "适应方式",
    "Fit mode",
    "适应宽度、高度或原始尺寸",
    "Fit width, height, or original size",
  ),
  item(
    "reader.launch_state",
    "reader",
    "打开漫画后的界面状态",
    "State when opening manga",
    "普通窗口、专注阅读或记住上次状态",
    "Windowed, focus reading, or remember last state",
    ["全屏", "专注"],
  ),
  item(
    "reader.controls_layout",
    "reader",
    "控制栏显示方式",
    "Control bar layout",
    "自动、覆盖漫画或预留空间",
    "Automatic, overlay, or reserved space",
    ["Overlay"],
  ),
  item(
    "reader.brightness",
    "display",
    "亮度",
    "Brightness",
    "默认图像亮度",
    "Default image brightness",
  ),
  item(
    "reader.contrast",
    "display",
    "对比度",
    "Contrast",
    "默认图像对比度",
    "Default image contrast",
  ),
  item(
    "reader.saturation",
    "display",
    "饱和度",
    "Saturation",
    "默认图像饱和度",
    "Default image saturation",
  ),
  item(
    "reader.grayscale",
    "display",
    "灰度",
    "Grayscale",
    "默认使用灰度显示",
    "Use grayscale by default",
  ),
  item(
    "reader.sharpen",
    "display",
    "锐化",
    "Sharpen",
    "默认启用图像锐化",
    "Enable image sharpening by default",
  ),
  item(
    "reader.trim_white",
    "display",
    "去白边",
    "Trim white borders",
    "默认自动裁去白边",
    "Trim white borders by default",
  ),
  item(
    "reader.background",
    "display",
    "阅读背景",
    "Reader background",
    "设置漫画周围背景颜色",
    "Set the background around pages",
  ),
  item(
    "shortcuts",
    "input",
    "键盘与快捷键",
    "Keyboard & shortcuts",
    "查看和编辑全部快捷键",
    "View and edit all shortcuts",
    ["按键", "冲突"],
  ),
  item(
    "gestures",
    "input",
    "鼠标与手势",
    "Mouse & gestures",
    "翻页、双击缩放和滚轮行为",
    "Paging, double-click zoom, and wheel behavior",
    ["双击", "滚轮", "拖动"],
  ),
  item(
    "performance.low_memory",
    "storage",
    "低内存模式",
    "Low memory mode",
    "降低预加载和缓存占用",
    "Reduce preload and cache usage",
  ),
  item(
    "cache.thumbnail_limit_mb",
    "storage",
    "缩略图缓存",
    "Thumbnail cache",
    "限制磁盘缩略图缓存大小",
    "Limit disk thumbnail cache size",
  ),
  item(
    "storage.clear_cache",
    "storage",
    "清除缓存",
    "Clear cache",
    "只清理可重新生成的缓存",
    "Clear only reproducible cache",
    ["空间"],
  ),
  item(
    "storage.cleanup",
    "storage",
    "清理失效项",
    "Clean stale items",
    "清理失效索引和缓存记录",
    "Clean stale index and cache records",
  ),
  item(
    "storage.optimize",
    "storage",
    "数据库优化",
    "Database optimization",
    "运行 ANALYZE 或 VACUUM",
    "Run ANALYZE or VACUUM",
  ),
  item(
    "data.health",
    "data",
    "数据库健康",
    "Database health",
    "检查本地数据库状态",
    "Check local database health",
  ),
  item(
    "data.backup",
    "data",
    "备份数据库",
    "Back up database",
    "创建 WAL 一致备份",
    "Create a WAL-consistent backup",
    ["恢复"],
  ),
  item(
    "data.location",
    "data",
    "数据位置",
    "Data location",
    "查看 MangaVault 本地数据位置",
    "View the MangaVault local data location",
  ),
  item(
    "data.reset",
    "data",
    "清空本地数据库",
    "Clear local database",
    "先备份后创建新的空数据库",
    "Back up before creating an empty database",
    ["危险", "重新开始"],
  ),
  item(
    "advanced.logs",
    "advanced",
    "日志",
    "Logs",
    "打开日志目录并查看日志文件",
    "Open the log folder and inspect log files",
  ),
  item(
    "advanced.formats",
    "advanced",
    "格式能力",
    "Format capabilities",
    "查看归档和 PDF 工具详情",
    "Inspect archive and PDF tool details",
  ),
  item(
    "advanced.developer",
    "advanced",
    "开发者模式",
    "Developer mode",
    "显示本地诊断能力",
    "Show local diagnostic capabilities",
  ),
  item(
    "about.version",
    "about",
    "版本",
    "Version",
    "当前 MangaVault Desktop 版本",
    "Current MangaVault Desktop version",
  ),
  item(
    "about.privacy",
    "about",
    "隐私与本地数据",
    "Privacy & local data",
    "漫画文件完全离线处理",
    "Manga files are processed entirely offline",
  ),
];

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  return settingsSections.some((entry) => entry.sectionId === value)
    ? (value as SettingsSectionId)
    : "general";
}

export function localizeSettingsText(text: LocalizedText, locale: Locale): string {
  return locale === "zh-CN" ? text.zh : text.en;
}

export function searchSettings(query: string, locale: Locale): SettingsSearchResult[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return settingsItems
    .map((entry) => {
      const sectionDefinition = settingsSections.find(
        (candidate) => candidate.sectionId === entry.sectionId,
      )!;
      const title = localizeSettingsText(entry.title, locale);
      const description = localizeSettingsText(entry.description, locale);
      const haystack = [
        title,
        description,
        entry.title.zh,
        entry.title.en,
        entry.description.zh,
        entry.description.en,
        ...entry.keywords,
        ...entry.aliases,
        ...sectionDefinition.keywords,
        ...sectionDefinition.searchAliases,
      ]
        .join(" ")
        .toLocaleLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return null;
      const normalizedTitle = title.toLocaleLowerCase();
      const score = terms.reduce(
        (total, term) =>
          total + (normalizedTitle === term ? 100 : normalizedTitle.includes(term) ? 20 : 1),
        0,
      );
      return {
        settingId: entry.settingId,
        sectionId: entry.sectionId,
        title,
        sectionTitle: localizeSettingsText(sectionDefinition.title, locale),
        description,
        focusTarget: entry.focusTarget,
        score,
      } satisfies SettingsSearchResult;
    })
    .filter((entry): entry is SettingsSearchResult => entry !== null)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 12);
}

function localized(zh: string, en: string): LocalizedText {
  return { zh, en };
}
