# MangaVault 与 JMComic-qt 元数据集成可行性报告

审计日期：2026-08-13  
MangaVault 基线：V1.0.0 Final（冻结）  
JMComic-qt 本地位置：`<workspace>\QT`  
JMComic-qt 审计提交：`7740ce3554a38ff2f90e1984ebc33b2e16005903`  
上游项目：https://github.com/tonquer/JMComic-qt

## 1. 结论

这项集成**有明确价值，也具备较高技术可行性**。当前下载目录本身已经形成可靠的弱关联：JMComic-qt 负责获取与下载，MangaVault 已能把 `作者/作品/original|waifu2x/章节/页面` 识别为一个逻辑作品。下一步最有价值的能力，是让 MangaVault 获得 JM ID、站点原始标题、作者、标签、分类、简介和章节来源信息。

但不建议把 JMComic-qt 的网络实现直接复制进 MangaVault，也不建议让两个应用共同读写对方的数据库。审计到的接口是 JMComic-qt 当前使用的站点接口，并非经过文档化、版本化和稳定性承诺的公共开放 API。它依赖动态域名、请求签名、Cookie、代理和站点协议细节；上游网络层还存在 `verify=False`。若直接并入，MangaVault 将承担站点变化、登录凭证、TLS、合规和发布维护风险。

推荐采用**本地识别优先、联网补全可选的混合方案**：

1. 先只读 JMComic-qt 的 `download.db`，用规范化作品根路径把本地书籍映射到 JM ID。
2. 已存在于 `favorite.db` 的作品，离线导入其标题、作者、标签、分类和简介。
3. 对缺失字段，提供用户明确启用的“JM 元数据补全”Provider；联网前展示匹配和变更预览。
4. 网络适配器独立于扫描器和 Reader，失败不得影响本地浏览、阅读或既有元数据。
5. 用户手工数据优先，来源字段可追溯、可撤销，批量刷新受限速和缓存控制。

因此，本项目应进入 **V1.1 的独立 Metadata Provider 批次**，不应以 1.0.x 热修复形式加入，也不应改变已经冻结的 V1.0.0 安装包。

## 2. 已确认的代码事实

### 2.1 JMComic-qt 能提供的数据

JMComic-qt 的作品详情解析当前能够取得：

| 数据     | JMComic-qt 字段                       | MangaVault 用途                        |
| -------- | ------------------------------------- | -------------------------------------- |
| JM ID    | `id` / `bookId`                       | 稳定的外部来源标识                     |
| 原始标题 | `name`                                | 来源标题；不破坏性清洗                 |
| 作者     | `author`                              | 作者列表与展示作者                     |
| 标签     | `tags`                                | 来源标签                               |
| 分类     | `category`、`category_sub`            | 来源分类                               |
| 简介     | `description`                         | 作品详情                               |
| 章节     | `series[].id/name/sort`               | 章节来源信息和匹配辅助                 |
| 封面地址 | `/media/albums/{id}_3x4.jpg`          | 可选远程封面，不应替代本地封面默认策略 |
| 站点状态 | `likes`、`total_views`、`is_favorite` | 只作为来源信息，不映射为本地评分       |

请求链路为 `GetBookInfoReq2(bookId)` 到 `/album?id=...`，响应经 `ParseBookInfo2` 写入内存中的 `BookMgr`。这证明元数据字段真实存在，但也说明网络契约与 JMComic-qt 的内部实现紧密耦合。

### 2.2 下载目录与 JM ID 的关联

JMComic-qt 的 `download.db` 至少记录：

- `bookId`
- `title`
- `savePath`
- `convertPath`
- 下载章节及进度

`savePath` 指向 `original`，`convertPath` 指向 `waifu2x`。下载命名支持：

```text
sample_library/作品/original
sample_library/[作者]作品/original
sample_library/作者/作品/original
```

MangaVault 已实现 `original`、`waifu2x`、章节目录与逻辑作品根的识别，也能逐页优先使用增强版本并回退原图。因此，使用 `download.db` 的路径与 MangaVault 的规范化逻辑作品根进行匹配，是当前取得 JM ID 的最高置信度方法。

### 2.3 两边数据库的承接能力

MangaVault 已有：

- `books.author`
- `chapters`
- `tags` / `book_tags`
- `metadata_sources`
- `metadata_history`
- 用户手工元数据变更历史

这使 Provider 身份、字段来源与变更审计可以沿用现有基础。不过，JM ID、来源简介、多作者原始数组、来源标签归属和同步状态目前没有完整的一等模型。生产实现建议新增小型、专用的 migration，而不是把 JM ID 隐藏在标题、普通标签或难查询的历史文本中。

## 3. 三种路线比较

| 方案                                 | 做法                                               | 优点                                               | 主要问题                                                                   | 结论                 |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | -------------------- |
| A. 直接把 JM 网络代码并入 MangaVault | Rust 重写或复制 Python 请求、签名、域名和登录      | 一体化、看似自动                                   | 非公开稳定 API；维护和合规风险最高；凭证边界扩大；复制 LGPL 代码需单独审查 | 不推荐               |
| B. 只读 JMComic 本地数据库           | 读取 `download.db`、`favorite.db`，不联网          | 快、低风险、可离线；最适合既有库                   | `download.db` 元数据不完整；未收藏作品缺少标签和简介；schema 无正式版本    | 推荐作为第一阶段     |
| C. 元数据 Provider + 本地桥接        | 本地数据库先取得 JM ID，独立 Provider 按需联网补全 | 自动化程度高；与 Reader/扫描器解耦；可缓存、可撤销 | 仍需维护站点适配器和安全边界                                               | 推荐的目标方案       |
| D. 修改 JMComic-qt 写 sidecar        | 下载完成后在作品根写 `.mangavault.json`            | 两个应用最松耦合；扫描稳定；无需共享数据库         | 需要维护本地 JMComic 分支或上游接受改动                                    | 推荐作为长期最稳接口 |

推荐组合顺序为 **B → C → D**：先交付安全的本地关联，再增加用户主动启用的联网 Provider，最后推动下载器输出版本化 sidecar。D 一旦稳定，可以逐步降低对 JMComic 内部 SQLite schema 的依赖。

## 4. 推荐架构

```text
JMComic-qt download.db / favorite.db
                 │ 只读快照
                 ▼
        JM Local Bridge Importer
                 │ 路径 + JM ID
                 ▼
        External Identity Resolver
                 │
        ┌────────┴────────┐
        ▼                 ▼
现有本地元数据       JM Metadata Provider（可选联网）
        │                 │ 限速、超时、缓存、取消
        └────────┬────────┘
                 ▼
          Metadata Merge Plan
            只读差异预览
                 ▼ 用户确认/自动规则
        事务写入 + metadata_history
```

### 4.1 模块边界

建议在 Rust 后端新增以下边界，而不是让 React 或扫描器直接发网络请求：

- `metadata/providers/mod.rs`：Provider trait 与统一错误模型。
- `metadata/providers/jmcomic.rs`：JM 字段解析和网络适配。
- `metadata/importers/jmcomic_local.rs`：只读导入本地 SQLite 快照。
- `metadata/matcher.rs`：路径、JM ID 与人工候选匹配。
- `metadata/merge.rs`：优先级、差异预览、提交与撤销。
- `metadata/jobs.rs`：可取消后台队列、并发限制和进度。

Provider 不得进入页面物化、Reader 缓存或核心扫描热路径。扫描完成后只入队“等待识别”任务；网络不可用时书籍仍立即可见、可读。

### 4.2 建议数据模型

V1.1 建议添加专用 migration：

```text
external_book_ids
- id
- book_id
- provider_id             # jmcomic
- remote_id               # JM ID
- match_method            # download_db_path / sidecar / manual / search
- match_confidence
- canonical_source_path
- created_at / updated_at
- UNIQUE(provider_id, remote_id)
- UNIQUE(book_id, provider_id)

external_book_metadata
- book_id
- provider_id
- remote_id
- original_title
- authors_json
- categories_json
- description
- chapters_json
- remote_cover_url
- source_payload_json     # 设大小上限，可选
- etag_or_hash
- fetched_at
- expires_at
- status

external_book_tags
- book_id
- provider_id
- normalized_tag
- source_tag
- created_at
- UNIQUE(book_id, provider_id, normalized_tag)
```

普通 `tags` 仍用于统一搜索和筛选，但来源关系需要单独记录。否则刷新 JM 标签时无法区分“上次由 JM 导入的标签”和“用户自己添加的同名标签”。

### 4.3 匹配优先级

自动匹配应从确定性高到低：

1. 已保存的 `(provider_id, remote_id)`。
2. 作品根中的受校验 `.mangavault.json`。
3. `download.db` 中 `savePath` / `convertPath` 规范化后与逻辑作品根完全相同。
4. `favorite.db` 的 JM ID 与已经建立的下载记录关联。
5. 用户在详情页手工输入 JM ID。
6. 标题 + 作者搜索只能生成候选，不得静默提交。

不得仅凭相似标题自动关联。`(C107)`、`COMITIA`、`COMIC1`、日文全角字符和作者别名会让模糊匹配出现真实误判；路径移动后也不能用旧字符串直接写入。

## 5. 元数据合并规则

### 5.1 字段优先级

推荐优先级：

1. MangaVault 用户手工编辑。
2. 用户在差异预览中明确接受的 Provider 值。
3. 已确认的 JM 来源元数据。
4. 目录与文件名解析结果。

具体规则：

- `title`：默认保留当前显示标题；JM 原始标题先进入来源信息。仅在当前标题未手工修改或用户明确勾选时替换。
- `author`：可填补空值；多作者原数组保存在来源元数据，展示字段使用稳定分隔符。
- `tags`：集合合并，不删除用户标签；刷新只替换同一 Provider 自己拥有的来源关系。
- `category`：建议显示为独立来源分类，或用 `JM/分类名` 命名空间映射，避免污染普通标签。
- `description`：新增详情字段，不塞入标题或标签。
- `chapter`：远程章节用于导航辅助；页面和实际章节边界仍以本地文件为准。
- `rating`、`favorite`：不由 likes/views/is_favorite 静默覆盖。
- `cover`：本地生成封面仍是默认；远程封面只可显式选择，并进入普通磁盘缓存配额。

所有实际变更都应写入 `metadata_history`，包含 Provider source id、旧值、新值、JM ID、获取时间与操作来源。批量应用前创建数据库备份并使用单一事务；单本失败不应回滚其他已独立确认的书籍批次。

### 5.2 用户体验

作品详情页建议增加默认折叠的“来源信息”：

- 来源：JMComic
- JM ID
- 来源标题、作者、分类、标签和简介
- 最后更新时间
- 匹配方式与置信度
- `刷新元数据`
- `查看差异`
- `取消关联`

批量入口放在 `设置 > 漫画库 > 元数据来源`：

- 启用 JM 元数据补全
- JMComic 数据目录
- 连接/读取状态
- 自动补全：关闭 / 仅确定 JM ID / 所有待确认候选
- 刷新间隔：手动、7 天、30 天
- 同时任务数
- 预览批量变更
- 清除远程缓存（不删除本地漫画和已确认元数据）

默认建议为：Provider 关闭、读取本地数据库需用户选择目录、仅对确定 JM ID 的书籍联网、应用前显示差异。

## 6. 联网实现的安全与性能边界

如果实现联网 Provider，必须满足：

- 使用 Rust 后台任务，不通过 WebView 直接请求站点。
- 每个 Provider 使用域名 allowlist，拒绝响应提供的任意跳转目标。
- TLS 证书校验必须开启；不得照搬 JMComic-qt 的 `verify=False`。
- 不读取 JMComic 的用户名、密码、Cookie、代理密码或完整 `config.ini`。
- 第一版优先支持无需账户的元数据查询；若未来确需凭证，使用 Windows Credential Manager，并单独评审。
- 设置连接和总超时、指数退避、失败熔断、每主机并发上限和请求速率上限。
- 相同 JM ID 使用 single-flight；成功响应按 hash/TTL 缓存，失败使用短期负缓存。
- 批量刷新默认每次 100 本，可暂停、取消和断点继续；不在应用启动时扫描 10,000 本并立即联网。
- 响应体设字节上限，严格 JSON 反序列化，未知字段忽略，关键字段缺失则不提交。
- 日志只记录 JM ID、状态码、耗时和错误类别，不记录 Cookie、token、完整响应或成人作品标题。
- 网络失败只显示“来源暂不可用”，不得把已有书籍标记为缺失或删除元数据。

“MangaVault 不需要完全离线”可以调整为：**本地阅读和管理始终离线可用，联网元数据是明确可关闭的附加能力**。这比把产品改造成必须联网更可靠。

## 7. 从 JMComic-qt 值得吸收的优化

### 推荐吸收

1. **来源身份贯穿下载生命周期**：JM ID 从详情、下载任务到作品路径保持一致，MangaVault 应建立一等外部 ID。
2. **作者目录/作者加标题命名兼容**：继续维护三种布局测试，不限定用户必须重命名现有目录。
3. **原图与增强版本并存**：现有逻辑已经成熟；元数据只需补充版本状态，不重写 Reader。
4. **章节远程 ID**：可帮助识别下载完整度和章节名称，但不取代本地页面事实。
5. **批量下载状态可见性**：MangaVault 可在来源信息中显示“本地完整/部分章节/增强版不完整”，不需要承担下载器职责。
6. **一键跨应用定位**：未来可提供“在 JMComic 中查看 JM ID”或“在 MangaVault 中打开作品根”，只传 ID/路径，不传凭证。

### 不建议吸收

1. 不复制 JMComic 的 Reader；MangaVault Reader 已成熟。
2. 不把 Python、PySide6、curl_cffi、`jmcomic` 和超分依赖打进 Tauri MSI。
3. 不直接共享或双向写入 `download.db`、`favorite.db`、`history.db`。
4. 不读取 `config.ini` 中的登录和代理信息。
5. 不复用关闭 TLS 校验的请求方式。
6. 不把远程点赞/浏览量映射成本地评分。
7. 不把 MangaVault 变成下载器或站点浏览器；这会显著扩大产品、合规和维护范围。

## 8. 许可证与产品风险

JMComic-qt 仓库使用 LGPL-3.0。参考其行为、协议边界和数据结构，与直接复制/修改其实现的分发义务不同。本报告不是法律意见；若复制实质性代码、链接其库或分发修改版，应在实施前完成许可证审查、保留版权与许可证通知，并确认可替换/重新链接等义务。

此外，仓库 README 将项目定位为技术研究用途。MangaVault 不应把该站点称为“官方合作来源”或把当前接口称为“官方开放 API”。更准确的产品文案是“JMComic 兼容元数据来源（非官方集成）”。用户应自行确认内容访问、账户和所在地区的合规性。

## 9. 实施路线

### Phase 0：验证性 Spike，不进入正式版

目标：在隔离测试数据库和合成目录中证明匹配链路。

- 只读打开 `download.db` 快照，不触碰真实 JMComic 数据库。
- 输出 `bookId → savePath/convertPath → MangaVault book_id` 预览。
- 用至少 100 本真实目录抽样统计准确匹配、缺失路径和冲突率。
- 验证作者目录、默认目录、`original/waifu2x`、多章节、长路径和非 ASCII。
- 不联网，不修改 MangaVault 正式数据库。

通过条件：确定性路径匹配准确率 100%，冲突全部进入人工检查。

### Phase 1：V1.1 本地桥接

- 添加专用 external identity migration。
- 导入 `download.db` 的 JM ID 和路径关系。
- 导入 `favorite.db` 中已有的来源元数据。
- 提供只读预览、选择性应用、审计记录和撤销。
- 详情页显示 JM ID 与来源信息。

这是投入产出比最高的一期，能够立即覆盖用户当前的下载库，且不引入站点网络风险。

### Phase 2：V1.1 可选联网 Provider

- 只对已确定 JM ID 的书籍按需查询。
- 增加任务队列、缓存、限速、取消和差异预览。
- 默认不自动覆盖标题和用户字段。
- 实现批量刷新，但不在启动时自动请求全库。
- Provider 关闭或失效时，本地阅读完全不受影响。

### Phase 3：Sidecar 协议与上游协作

- 定义版本化 `.mangavault.json` schema。
- 在 JMComic 下载成功后原子写入作品根。
- 不写 Cookie、token、用户名、代理或域名配置。
- MangaVault 扫描时校验大小、schema、相对路径和越界。
- 尝试以独立 PR 提交上游；若只维护本地分支，要明确同步成本。

## 10. 测试与验收

至少覆盖：

- 三种 JMComic 保存命名模式。
- `original`、`waifu2x`、多章节与部分增强回退。
- 路径大小写、长路径、UNC、中文、日文、全角字符和移动后的目录。
- 同一 JM ID 映射多个本地路径、一个路径映射多个 JM ID 的冲突。
- `(C79)` 到 `(C107)`、COMITIA、COMIC1 等标题完整保留。
- 用户手工标题、作者和标签不被刷新覆盖。
- Provider 标签刷新不删除用户标签。
- `download.db` 正在写入、被锁定、损坏或 schema 漂移时安全失败。
- 网络超时、TLS 错误、429、5xx、无效 JSON、超大响应和字段缺失。
- 取消批量任务、重启恢复、single-flight、TTL 缓存和并发上限。
- 事务失败完整回滚，备份失败禁止批量覆盖。
- 日志与崩溃报告不泄漏凭证、完整响应或敏感标题。
- 10,000 本库只对目标批次创建任务，不产生请求风暴或阻塞 UI。

## 11. 最终建议

**建议做，但不要从“把 JM API 接进 MangaVault”开始。**正确起点是利用本地 `download.db` 建立 JM ID，再把联网能力封装为关闭也不影响产品的 Metadata Provider。

优先级建议：

| 优先级 | 项目                                             | 理由                                 |
| ------ | ------------------------------------------------ | ------------------------------------ |
| P1     | 本地 JM ID 路径映射与预览                        | 对现有漫画库价值最高，风险最低       |
| P1     | 来源字段、覆盖优先级与审计                       | 防止重扫/刷新破坏手工数据            |
| P2     | `favorite.db` 元数据导入                         | 可立即获得一批标签与简介             |
| P2     | 按 JM ID 的可选联网补全                          | 自动化价值高，但需要稳定性和安全投入 |
| P2     | 详情页来源信息与批量管理                         | 让功能可理解、可撤销                 |
| P3     | `.mangavault.json` sidecar                       | 长期最稳，需要协调 JMComic 改动      |
| 不做   | 把 JMComic 下载器/Reader/凭证系统并入 MangaVault | 偏离产品边界，风险和维护成本过高     |

预估上，本地桥接是中等规模改动；完整联网 Provider 是独立的大型功能，必须按 V1.1 正式批次设计、迁移、测试和发布，不能作为 V1.0.1 的顺手增强。

## 12. 参考资料

- JMComic-qt 项目说明与许可证：https://github.com/tonquer/JMComic-qt
- 作品详情解析：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/tools/tool.py#L555-L598
- 作品详情请求：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/server/req.py#L487-L520
- 请求签名与请求头：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/server/req.py#L182-L213
- 下载目录规则：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/view/download/download_item.py#L253-L360
- 下载数据库：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/view/download/download_db.py#L12-L63
- 本地收藏数据库：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/view/user/local_favorite_db.py#L14-L67
- 网络实现：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/server/server.py#L353-L430
- 运行依赖：https://github.com/tonquer/JMComic-qt/blob/7740ce3554a38ff2f90e1984ebc33b2e16005903/src/requirements.txt
