# MangaVault Desktop

面向 Windows 的本地漫画管理与阅读器，将分散在文件夹、压缩包和 PDF 中的漫画整理成可搜索、可筛选、可续读的个人书库。

当前版本为 **1.1.0-rc.1**，属于 Windows x64 外部验证版本，尚不是正式稳定版。项目采用 Tauri 2、Rust、React、TypeScript 和 SQLite 构建；源码保留跨平台架构，但本次版本不提供经过验证的 macOS 或 Linux 安装包。

> 本仓库提供项目源码，不包含漫画文件、个人书库数据库、下载记录或预编译安装包。GitHub 的源码 ZIP 不是可直接运行的桌面程序。

## 主要功能

- **导入与扫描**：添加多个漫画文件夹，递归扫描子目录，或导入单个压缩包和 PDF；后台任务支持进度查看、取消与重试。
- **书库管理**：提供网格、列表、封面墙和系列视图，支持搜索、标签、收藏、评分、重复检测及元数据编辑。
- **阅读模式**：支持单页、双页和连续滚动，可切换从左到右或从右到左的阅读方向。
- **阅读控制**：支持缩放、适应宽度或高度、缩略图、页面跳转、书签，以及亮度、对比度、灰度、旋转等图像调整。
- **专注阅读**：全屏阅读、自动隐藏控件、鼠标热区和可自定义的键盘快捷键、鼠标手势。
- **进度与历史**：自动保存阅读进度，在“最近阅读”中继续阅读；清除历史记录不会清除书签或阅读进度。
- **本地数据保护**：书库数据与漫画原文件分开保存，支持数据库健康检查、备份与恢复。
- **标题与版本整理**：保留 `(C107)`、COMITIA、COMIC1 等展会标记，识别受支持的原图与增强图目录结构，并在增强图缺失时回退到原图。
- **可选 JMComic 元数据**：只读识别 JMComic-qt 的本地下载记录，经用户确认 JM ID 并单独开启联网功能后，可补充标题、作者、标签、分类与简介；来源数据不会覆盖用户手动维护的元数据。

## 支持的格式

| 类型 | 格式 |
| --- | --- |
| 图片文件夹 | JPG、JPEG、PNG、WebP、AVIF |
| 漫画压缩包 | CBZ、CBR、ZIP、RAR、7Z |
| 文档 | PDF |

Windows 安装包构建时会包含应用专用的 7-Zip 和 Poppler 工具，用于压缩包解包与 PDF 渲染。项目对路径穿越、异常解压量和超大页面等情况设有保护；单本漫画导入失败不会撤销其他漫画的成功导入。

## 隐私与联网

MangaVault **默认离线运行**，不上传漫画页面、缩略图、本地路径、阅读历史、书签或数据库内容。

- 应用数据保存在 Windows 用户目录中，与安装目录和漫画原文件分开。
- JMComic 本地关联读取 `download.db` 的一致性只读快照，不修改下载器数据库或漫画源文件，也不读取下载器凭据与配置文件。
- JMComic 网络元数据默认关闭，需要先确认关联，再单独启用；启用后只向允许的 HTTPS 元数据端点发送已确认的数字 JM ID。
- 默认不发送遥测数据，不自动下载 AI 模型，也不启用云同步或插件执行。

完整说明见 [隐私说明](docs/PRIVACY.md) 与 [JMComic 元数据指南](docs/V1_1_JMCOMIC_READER_METADATA.md)。

## 安装与使用

当前验证目标为 **Windows 10 / Windows 11 x64**。桌面程序依赖 Microsoft Edge WebView2；缺少运行时时，安装过程可能需要联网获取该组件。

如果你已有可信来源提供的 `.msi` 安装包，可以直接安装。测试安装包尚未签名，系统可能显示“未知发布者”提示；安装前请核对发布者提供的 SHA-256 校验值，不要仅凭文件名判断是否可信。

首次使用时添加漫画文件夹或导入文件，等待后台扫描完成后即可阅读。默认单击选择、双击打开，也可在设置中切换为单击打开。

升级旧版本会保留用户目录中的应用数据；卸载不会自动删除书库数据库或漫画原文件。操作数据库或恢复备份前，请先阅读 [备份与恢复](docs/BACKUP_AND_RECOVERY.md)。

## 从源码运行

### 开发环境

- Node.js 22 与 npm
- Rust 稳定版及 Cargo
- Microsoft C++ Build Tools，包含 C++ 工作负载与 Windows SDK
- Microsoft Edge WebView2

获取源码并进入项目根目录，在 PowerShell 中执行：

```powershell
npm ci
npm run vendor:windows-tools
npm run tauri:dev:msvc
```

`vendor:windows-tools` 会下载指定版本的 7-Zip 与 Poppler，并核对 SHA-256，将工具准备在项目内，不进行系统级安装。公开仓库不存放这些可重新下载的二进制文件，因此首次从源码运行或打包前需要执行此步骤。

如果提示找不到 `link.exe`，请检查是否安装了 C++ Build Tools 和 Windows SDK。`tauri:dev:msvc` 会通过项目内的脚本加载 MSVC 构建环境。

仅调试前端时可执行 `npm run dev`，但浏览器预览不等同于完整桌面程序，本地文件和数据库等原生功能需要 Tauri 环境。

### 构建 Windows 安装包

依赖与应用专用工具准备完成后，执行：

```powershell
npm run release:windows
```

生成的安装包位于 `src-tauri/target/release/bundle`。更多环境要求见 [构建说明](docs/BUILDING.md)。

### 质量检查

首次运行端到端测试前，先安装 Playwright 使用的浏览器：

```powershell
npx playwright install chromium
```

前端检查：

```powershell
npx prettier --check .
npm run lint
npx tsc --noEmit
npm test
npm run e2e
```

Rust 检查：

```powershell
.\scripts\cargo-msvc.cmd cargo fmt --manifest-path src-tauri\Cargo.toml --check
.\scripts\cargo-msvc.cmd cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
.\scripts\cargo-msvc.cmd cargo test --manifest-path src-tauri\Cargo.toml
```

## 文档导航

- [使用指南](docs/USER_GUIDE.md)
- [快捷键与鼠标手势](docs/SHORTCUTS.md)
- [备份与恢复](docs/BACKUP_AND_RECOVERY.md)
- [隐私说明](docs/PRIVACY.md)
- [构建说明](docs/BUILDING.md)
- [已知问题](KNOWN_ISSUES.md)
- [V1.0.0 发布说明](RELEASE_NOTES_V1.0.0.md)
- [V1.1 JMComic 元数据指南](docs/V1_1_JMCOMIC_READER_METADATA.md)
- [项目路线图](ROADMAP.md)
- [V1.1 待办事项](V1_1_BACKLOG.md)

## 当前边界

V1.1 主要聚焦本地漫画管理、阅读体验与可选的 JMComic 元数据功能。本版本未提供 OCR、翻译、云同步、插件市场或内置 AI 模型功能；路线图中的规划不代表已经实现。

V1.0.x 的维护仅接受 P0/P1 级修复。使用 RC 版本前，请查看已知问题并备份重要的应用数据。
