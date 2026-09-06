# Lumer Assistant 技术架构

**版本**：v1.3（Final Paper Card 门控 Chat 扩展）

> 本文回答“系统如何构成、Annot 哪些能力复用、各模块职责是什么”。字段级不可违反规则见 `docs/contracts/`。

## 1. 核心技术口径

以下口径随本计划一并批准；若任一项需要改变，应先返回 `/plan`。

1. **运行方式**：Next.js 本地 Web 服务只绑定 `127.0.0.1`。
2. **Vault 配置**：配置与业务数据分离；统一使用 `lumer` 命名，机器级配置位于 `~/.lumer/config.json`，Vault 业务数据位于 `<Vault>/.lumer/`。
3. **Analyze 会话/任务**：复用同一 Provider port、Run 状态机与 Streaming 边界；每次实际 Analyze/Retry 新建任务，不续接自由 Chat 历史。Codex 使用独立 Session；OpenAI-compatible Overview 使用不可续接的 HTTP task correlation ID；纯 `derive-draft` 不调用 Provider、会话为 `null`；V1 全局最多一个 `running` 或 `finalizing` Analyze。
4. **结构化输出**：Analyze 收集完整响应后再解析 JSON；UI 只流式展示阶段状态，不渲染半截 JSON。
5. **Evidence Verification 含义**：V1 确认引文确实存在、页码可定位且属于当前 PDF 正文；不宣称自动完成 Finding 与引文之间的语义蕴含判断，语义正确性由 Preview/Edit 承担。
6. **页码约定**：内部统一使用 0-based `pdf_page_index`；UI 和 Markdown 使用 1-based `display_page_number`。
7. **PDF 身份**：导入字节的 `source_sha256` 一经创建永久保留；写入 Annotation 后不得用当前 PDF 二进制哈希覆盖它。
8. **正文身份**：正文提取结果计算 `content_hash`；Annotation 内容不得进入正文文本或 Evidence。
9. **删除**：一次明确确认后永久删除该 Paper 的应用管理数据，不增加恢复系统。
10. **写入可靠性**：持久化 JSON 使用同目录临时文件、flush/fsync、close 和 atomic rename；`current_final_run_id` 是 Final commit point。Markdown 是提交后的派生输出，不建设跨文件强事务。

---

## 2. Annot 复用与清理边界

| Annot 能力 | Lumer 处理方式 |
|---|---|
| Next.js / React / Tailwind 基础 | 复制到当前仓库并更名为 Lumer |
| `PdfViewer`、`react-pdf`、PDF worker | 保留并按 `paper_id` 重接数据 |
| PyMuPDF Highlight / Memo | 保留；继续写入托管 PDF 标准 Annotation |
| Provider | 保留 Codex Provider Adapter 与鉴权检测；5E–5F 增加 OpenAI-compatible HTTP Overview Adapter，7C 扩展为 Final Paper Card 后的 HTTP Chat；Claude Code 仍只保留不可操作 UI 占位 |
| Session / Streaming | 保留核心实现；去除 Folder Session，增加 Analyze 任务入口 |
| Markdown Preview / Download | 保留组件模式，主流程改为 Vault 写入 |
| Folder Tree / FolderView / Folder API | 删除，不进入 Lumer 产品层 |
| Annot 首页、品牌、Demo、Prompt | 删除或重写 |
| `.annot/sessions.json` | 改为 `.lumer/sessions/<paper_id>.json` |
| `/api/papers` 空列表实现 | 重写为真实 Paper Repository API |
| Annot 路径、环境变量和存储键 | 全部更名为 Lumer，不允许残留运行时引用 |

独立性验收：

- Lumer 源码、构建配置和运行命令全部位于当前仓库。
- 删除或移动兄弟目录 Annot 后，Lumer 的安装、构建和运行不受影响。
- 源码中不存在指向 `/Users/.../Annot`、`../Annot` 或 Annot API 的运行时路径。

---

## 3. 数据与文件总体布局

### 3.1 Vault 布局

```text
Vault/
├── Papers/
│   └── <safe-original-stem>--<paper-id-short>.pdf
├── Paper Cards/
│   └── <safe-title>--<paper-id-short>.md
└── .lumer/
    ├── papers/
    │   └── <paper_id>.json
    ├── extractions/
    │   └── <paper_id>.json
    ├── analyses/
    │   └── <paper_id>/
    │       └── <analysis_run_id>.json
    ├── operations/
    │   ├── imports/
    │   │   └── <paper_id>.json
    │   └── annotations/
    │       └── <paper_id>.json
    ├── runtime.lock
    └── sessions/
        └── <paper_id>.json
```

### 3.2 文件所有权

| 文件 | 所有权与写入规则 |
|---|---|
| `Papers/*.pdf` | Lumer 托管；允许写标准 Annotation，不修改正文内容 |
| `.lumer/papers/*.json` | Lumer 唯一维护，Paper Source of Truth |
| `.lumer/extractions/*.json` | Lumer 可重建缓存，正文与页级 locator 基线 |
| `.lumer/analyses/**/*.json` | Lumer 维护；保存所有 Draft、失败信息和历史 Final |
| `.lumer/operations/imports/*.json` | Lumer 维护的短生命周期导入恢复 journal；不是业务 Source of Truth |
| `.lumer/operations/annotations/*.json` | Lumer 维护的短生命周期 Annotation 恢复 journal；不是业务 Source of Truth |
| `.lumer/runtime.lock` | 当前进程持有的跨进程 Vault 排他锁；不承载业务状态 |
| `.lumer/sessions/*.json` | Lumer 维护的 PDF Chat Session |
| `Paper Cards/*.md` | Lumer 生成、用户可编辑；覆盖前必须执行 hash 冲突检查 |

> 具体配置、命名、PaperRecord、ExtractedPaper 与 Final commit 规则见 `docs/contracts/storage.md`。

## 4. 应用组件与模块边界

### 4.0 依赖方向与目录职责

冻结依赖方向：

```text
Next Route / React UI
        ↓
Application Service / Coordinator
        ↓
Domain type + pure policy
        ↓
Repository port / Provider port
        ↓
Filesystem adapter / CLI adapter / PyMuPDF worker
```

- `src/domain/`：领域类型、enum、纯状态转换与 invariant；不得导入 Next.js、React、Node filesystem、CLI 或具体 Repository。
- `src/application/`：编排一个用例、事务边界和跨 Repository 顺序；不得直接读写文件或 spawn CLI。
- `src/lib/storage/`：路径约束、原子文件与 Repository 实现；只接受已校验领域 DTO。
- `src/lib/ai-providers/`：Provider port、Registry、Codex CLI Adapter 与 OpenAI-compatible HTTP Adapter；只转换外部协议，不拥有 Paper/Run/Gate 状态。Claude Code UI 占位不得导入或调用 runtime。
- `src/lib/pdf/`：PDF 支持检查、正文提取、Annotation worker 与页码桥接；不得写 AnalysisRun。
- `src/lib/evidence/` 与 `src/lib/markdown/`：纯确定性算法优先；I/O 分别由 Evidence Service 和 Markdown Writer 边界调用。
- `src/app/api/`：同源检查、解析、DTO 校验、调用 application service、响应映射；正式路径和 DTO 以 `docs/contracts/api.md` 为准。
- `src/components/`：展示和用户交互；不得直接访问 Vault、Provider CLI 或构造领域提交。

禁止横向绕过：Route 不直接写 Repository，Repository 不调用 Provider，Provider Adapter 不写领域文件，Renderer 不反向解析 Markdown，UI 不自行决定 Gate 或 Run 状态。

### 4.1 独立项目基线

目标：先得到“功能未变但已独立”的 Lumer 基线，再做产品重构。

冻结变化：

- 复制 Annot 当前源码快照到本仓库，不复制 Annot `.git`。
- `package.json`、页面标题、localStorage key、环境变量、API 文案统一更名为 Lumer。
- 增加只绑定 `127.0.0.1` 的本地启动命令；日常使用走 production build/start，不把开发服务器作为交付形态。
- 保留锁文件，新增 `typecheck`、`test`、`test:integration`、`test:e2e` scripts。
- 建立 Vitest、React Testing Library 和 Playwright 基础配置。
- 记录上游 commit，但运行时无兄弟仓库依赖。

### 4.2 Settings 与 Vault 配置

冻结模块：

```text
src/lib/config/lumer-config.ts
src/application/settings-service.ts
src/application/vault-operation-coordinator.ts
src/lib/config/lumer-config-repository.ts
src/app/api/settings/route.ts
src/app/settings/page.tsx
```

职责：

- 读取、验证、原子保存 `~/.lumer/config.json`。
- 提供 Vault、默认 Chat Provider、默认 Analyze Provider 和一个 OpenAI-compatible 配置档案；App、base URL、model、API Key 仅由 Settings 写入 `~/.lumer/config.json` 的 schema 2 对象。API Key 不进入 Vault、业务记录、响应或日志。
- 未配置 Vault 时，Library 显示阻塞式 onboarding，不自动创建未知路径。
- 更换 Vault 只切换数据源，不移动旧 Vault 内容。
- Vault 失效或无权限时进入 Settings 修复，不回退到临时目录。
- 每个业务请求在开始时取得不可变 `VaultContext`（canonical realpath + 当前配置代次）；请求期间不得再次读取全局配置重新解析根目录。
- Import、Annotation、Chat Provider task、Analyze/Finalize、Markdown sync 和 Delete 持有 Vault mutation lease；切换 Vault 必须取得 exclusive lease，有在途 mutation 时返回 `VAULT_BUSY`。
- 每个 Vault 同时只允许一个 Lumer 进程持有 `.lumer/runtime.lock`；切换成功前先取得新 Vault 锁并完成校验，再原子保存配置，最后释放旧 Vault 锁。

### 4.3 Paper Repository、导入与 Library

冻结模块：

```text
src/domain/paper.ts
src/application/import-paper-service.ts
src/application/import-coordinator.ts
src/application/paper-operation-coordinator.ts
src/application/paper-lifecycle-service.ts
src/application/recovery-service.ts
src/lib/storage/atomic-file.ts
src/lib/storage/managed-pdf-store.ts
src/lib/storage/paper-repository.ts
src/lib/storage/extraction-repository.ts
src/lib/storage/import-operation-repository.ts
src/lib/storage/annotation-operation-repository.ts
src/lib/papers/import-paper.ts
src/app/api/papers/route.ts
src/app/api/papers/import/route.ts
src/app/api/papers/[paperId]/route.ts
src/components/library/LibraryPage.tsx
src/components/library/PaperList.tsx
src/components/library/PaperFilters.tsx
```

导入顺序：

1. 校验扩展名、PDF 文件头和基本可读性。
2. 流式计算输入 SHA-256。
3. 扫描 PaperRecord 的 `source_sha256`。
4. 命中重复项时不写文件，返回已有 `paper_id` 并打开。
5. 未命中时执行 PyMuPDF inspection/text extraction。
6. 不支持则返回明确错误，不创建半成品记录。
7. 按 C02 生成带 `paper-id-short` 的 canonical 路径，先创建 `preparing` Import journal，再写入 journal 指定的同目录临时 PDF/Extraction。
8. 临时文件完成后推进 journal，原子 rename canonical PDF/Extraction，最后创建 `PaperRecord` 作为 commit point。
9. 清理 journal，Library 刷新并打开论文。

Library 功能：

- 标题搜索。
- Status/Tag 筛选。
- Metadata、Tags、Status 编辑。
- 是否存在 Current Final 的状态展示。
- Paper 永久删除。

删除保持 Annot 模式：一次确认后，在排他 lifecycle lease 内先恢复并清空该 Paper 的 Operation journals，再删除托管 PDF、PaperRecord、Extraction、全部 AnalysisRuns、PDF Sessions 和当前 `card_path` 指向的受管 Paper Card；无法安全恢复的 journal 阻止删除，已因“另存新文件”退出 Lumer 管理范围的旧 Markdown 不删除。确认文本明确列出对象，不增加废纸篓或恢复机制。

### 4.4 Reader、Annotation 与页码桥接

冻结保留并重接：

```text
src/components/reader/PdfViewer.tsx
src/lib/pdf/pdf-annotations.ts
src/app/api/papers/[paperId]/pdf/route.ts
src/app/api/papers/[paperId]/annotations/route.ts
src/app/api/papers/[paperId]/annotations/[annotationId]/route.ts
```

新增：

```text
src/application/annotation-service.ts
src/lib/pdf/pdf-text-extractor.ts
src/lib/pdf/pdf-support-check.ts
src/lib/pdf/page-navigation.ts
```

职责：

- Viewer 通过 `paper_id` 读取 `PaperRecord.pdf_path`，不接受任意绝对路径。
- Highlight/Memo 继续调用 PyMuPDF，并验证只产生 Annotation 变化。
- Annotation 写入必须先创建 `preparing` journal，再在 canonical PDF 的同目录临时副本上完成；重新提取验证 `content_hash` 不变并把 journal 推进为 `ready_to_commit` 后，才允许 fsync + atomic rename，不得对 canonical PDF 直接执行不可恢复的增量写入。
- 同一 Paper 的 Annotation 写操作由 `AnnotationService` 串行化，并使用 Annotation journal 协调 PDF rename 与 PaperRecord 当前托管字节 hash；PDF GET 持有共享 read lock、Annotation 持有排他 write lock，同时持有 PaperRecord-write mutex，因此 Reader 只能观察到提交前或提交后的完整 PDF+Record 组合。
- Evidence 点击使用 `pdf_page_index` 跳转到物理页。
- URL 或 Reader 状态允许携带 `page=<display_page_number>`，以支持 Card 回跳。
- PDF 缺失、损坏或被替换时显示明确错误，不自动创建新 Paper。

### 4.5 Provider、Chat 与 Analyze 入口

冻结保留：

```text
src/lib/ai-providers/*
src/lib/codex-exec.ts
src/lib/session-store.ts
src/app/api/providers/route.ts
src/app/api/papers/[paperId]/chat/route.ts
```

已规划/新增：

```text
src/application/chat-service.ts
src/application/analysis-service.ts
src/application/analyze-coordinator.ts
src/application/finalization-service.ts
src/domain/analysis-run.ts
src/domain/paper-analysis.ts
src/lib/storage/analysis-run-repository.ts
src/lib/analysis/analysis-schema.ts
src/lib/analysis/structured-output.ts
src/ai/prompts/paper-analysis.ts
src/app/api/analysis-runs/route.ts
src/app/api/analysis-runs/active/route.ts
src/app/api/analysis-runs/[runId]/**/route.ts
```

5E–5F 追加模块：

```text
src/lib/ai-providers/provider-registry.ts
src/lib/ai-providers/openai-compatible-config.ts
src/lib/ai-providers/openai-compatible-adapter.ts
```

Provider 依赖方向固定为：

```text
Route / UI
    ├── 显式 AnalyzeProvider → Analysis Service / Coordinator
    └── 显式 ChatProvider → Chat Service → PaperChatContextBuilder
                                      ↓ resolve(provider)
                                Provider Registry
                                  ├── codex → Codex CLI Adapter
                                  └── openai_compatible → HTTP Adapter
```

- Registry 只解析已批准的固定 Provider ID，不接受客户端传入 class、module、base URL、model、headers 或其他执行参数。
- OpenAI-compatible Adapter 使用服务端环境配置和原生 `fetch`；不得建立第二套 Run、SSE、取消、持久化、Evidence 或 Final 逻辑。
- Chat Service 只在 PaperRecord 已有 `current_final_run_id → finalized` Final Paper Card 后进入；该检查在 Service 内完成，Reader 的隐藏只是第二层 UI 门。
- `PaperChatContextBuilder` 是 Chat 正文上下文的唯一 owner：校验 Extraction 身份，在本地按版本化 `max_estimated_tokens=250,000` 总预算选择带页码段落，并仅组装当前 Provider 的有限消息历史；该值是应用硬上限，不等同于外部 Provider 的稳定接受证明；Provider Adapter 不读取 Vault 或 Session 文件。
- Codex Chat 续接专属 Codex Session；HTTP Chat 每次新建 task，由应用侧重放其专属历史，两个 Provider 不串用。
- HTTP Provider 的正文外发只发生在用户显式选择 HTTP Analyze 或 HTTP Chat 并发起请求后；Provider 状态检查不得携带论文正文。

Analyze 流程：

1. Analyze Coordinator 原子检查全局不存在 `running/finalizing` Run；否则拒绝并返回当前活动 Paper/Run。
2. 从受限 Registry 解析所选 Provider，校验对应 CLI 或 HTTP 配置、鉴权和可用性；不自动 fallback。
3. 创建 `running` AnalysisRun 和全新的 Analyze Provider Session/task correlation ID。
4. 校验并加载 `ExtractedPaper`。
5. 使用固定 `prompt_version` 和 page-tagged 正文构造请求。
6. 把 PDF 正文作为明确分隔的非可信数据传入；正文中的命令或提示语不得覆盖 Paper Card System Prompt。
7. Streaming 只发送阶段状态和错误，不展示半成品 JSON，也不长期保存中间事件。
8. Overview 收集完整 Markdown 后进入只读 `preview`；Codex 结构化 Analyze 才执行严格 `JSON.parse` + Zod。
9. Codex 结构化输出第一次失败时，在同一 Run 内追加 attempt，把原始 JSON 和 Schema Error 交给同一 Codex Session 做一次“只修结构”任务。
10. 第二次仍失败则记录 `failed`，不得创建可保存 Card；OpenAI-compatible 不进入该分支。
11. Codex Schema 成功后执行 Evidence Verification，结果进入 Draft；Evidence Gate 状态独立于 Run state。OpenAI-compatible 5F 结果止于 `preview`。

自由 Chat：

- Chat 不是导入后即刻可用的阅读器能力：只有已有 Final Paper Card 才显示和执行；`preview`/`draft` 不得解锁。
- Chat Session 与 AnalysisRun 分开存储；每个 Paper × Provider 有独立 Chat 历史。Codex 可续接 Session，HTTP 只有不可续接 task 与应用侧历史。
- Explain Selection / Translate 使用同一 Chat 入口和当前选中文本，不写入 PaperAnalysis；它们同样受 Final Paper Card 门约束。

### 4.6 Evidence Verification

冻结模块：

```text
src/application/evidence-service.ts
src/lib/evidence/normalize-text.ts
src/lib/evidence/locate-quote.ts
src/lib/evidence/verify-analysis.ts
```

实现原则：

- 确定性代码负责 locator；不调用第二个模型。
- 保留 `model_quote`，并把命中的真实原文、物理页、字符 span 与 normalization steps 一起保存。
- exact 与 C06 允许的 normalized 规则必须固定并有测试；禁止模糊、语义和跨页自动放行。
- Gate 结果包含每个 Finding 的通过/失败原因。
- 只有 Current PDF 的 `content_hash` 与 AnalysisRun 一致时才能验证。

### 4.7 Paper Card Preview、编辑与 Final

冻结路由与组件：

```text
/reader/<paper_id>
/papers/<paper_id>/analysis/<analysis_run_id>

src/components/analysis/AnalysisProgress.tsx
src/components/analysis/PaperCardEditor.tsx
src/components/analysis/EvidenceEditor.tsx
src/components/analysis/EvidenceGateSummary.tsx
src/components/analysis/AnalysisHistory.tsx
```

状态行为：

- Analyze 完成后打开新 Draft，不离开 Current Final。
- 编辑立即保存 Draft JSON，避免页面切换丢失。
- “编辑 Final”复制为带 `derived_from_run_id` 的新 Draft，不修改历史 Final。
- Evidence 点击打开 Reader 对应页。
- Gate 通过后才启用 `Save as Final`。
- `Save as Final` 严格执行 C07 preflight、`finalizing`、原子 commit point 与恢复流程。
- 保存新 Final 后旧 Run 仍保持 `finalized` 并显示在 History；不使用版本关系状态。
- 失败或取消重新 Analyze 不影响 Current Final。

### 4.8 Markdown Renderer 与外部冲突

冻结模块：

```text
src/application/markdown-sync-service.ts
src/lib/markdown/paper-card-renderer.ts
src/lib/markdown/markdown-writer.ts
src/components/analysis/MarkdownConflictDialog.tsx
```

规则：

- Renderer 为按版本选择的纯函数；相同 Final JSON 与 `renderer_version` 产生相同 Markdown 正文，恢复时不得静默切换模板版本。
- `Generated at` 等不稳定值不进入确定性正文，必要时间写入 JSON/frontmatter 固定字段。
- Markdown 只从已提交的 Current Final 生成；首次成功写入后记录 `card_path`、`markdown_hash` 和 `synced`。
- 再次写入前比较磁盘当前 hash 与已记录 hash。
- hash 相同：允许原子覆盖。
- hash 不同：只能选择取消整个 Final save、明确覆盖或按 C02 另存新文件。
- 在实际 rename 前再次比较预期 hash，消除用户选择后文件又被修改的竞态。
- 每次首次/重试同步都必须在 Markdown I/O 前把本次目标、action、expected/rendered hash 原子保存为 PaperRecord 的 `markdown_sync_context`；Recovery 不复用旧 Final 请求的内存参数。
- Markdown I/O 失败或二次 hash 冲突只更新 `markdown_sync_status=error|conflict` 并保留当前 `markdown_sync_context`，不得回滚 Current Final。
- 另存成功后才更新 canonical `card_path`/`markdown_hash`；旧文件保持不动并退出 Lumer 管理范围。
- 应用永不解析 Markdown 回写 JSON。

### 4.9 错误与阶段状态

用户可见阶段：

```text
validating_pdf
extracting_text
calling_provider
validating_schema
repairing_schema
verifying_evidence
draft_ready
preview_ready
finalizing
save_conflict
final_saved
syncing_markdown
markdown_sync_error
interrupted
failed
```

每个失败必须包含：

- 所在阶段。
- 可理解的错误原因。
- 是否可以 Retry。
- 是否保留 Draft。
- Current Final 是否仍安全保留。

### 4.10 数据写入所有权

| 资源 | 唯一底层写入者 | 可发起写入的 Application Service | 不允许直接写入者 |
|---|---|---|---|
| `~/.lumer/config.json` | `LumerConfigRepository` | `SettingsService` | Route、UI、Provider Adapter |
| `Papers/*.pdf` 文件创建 | `ManagedPdfStore` 经 atomic file | `ImportPaperService` | Paper Repository、Reader、Chat |
| `Papers/*.pdf` Annotation | `PdfAnnotationWorker` | `AnnotationService` | Extraction、Evidence、Chat |
| `.lumer/papers/*.json` | `PaperRepository` | Metadata、Import、Annotation、Finalization、MarkdownSync、Recovery、Lifecycle Service | Route、UI、Renderer、Provider |
| `.lumer/extractions/*.json` | `ExtractionRepository` | `ImportPaperService`；后续显式重提取用例 | Annotation、Evidence、Provider |
| `.lumer/analyses/**/*.json` | `AnalysisRunRepository` | Analysis/Evidence/Finalization/Recovery Service | Route、UI、Markdown Writer、Provider |
| `.lumer/operations/imports/*.json` | `ImportOperationRepository` | `ImportPaperService`、`RecoveryService` | Route、UI、Reader、Provider |
| `.lumer/operations/annotations/*.json` | `AnnotationOperationRepository` | `AnnotationService`、`RecoveryService` | Route、UI、Evidence、Provider |
| `.lumer/runtime.lock` | `VaultRuntimeLock` | Settings/bootstrap | Route、UI、业务 Repository |
| `.lumer/sessions/*.json` | `SessionRepository` | `ChatService` | Analysis Service、Provider Adapter、Paper Repository |
| `Paper Cards/*.md` | `MarkdownWriter` | Finalization/MarkdownSync Service | Renderer、UI、Paper Repository |

跨资源编排只有以下六个合法 owner：

1. `ImportPaperService`：Managed PDF → Extraction → PaperRecord；任何失败不得留下可见半成品 PaperRecord。
2. `AnnotationService`：Annotation journal → canonical PDF → PaperRecord hash/revision commit point；不得修改 Extraction 正文基线。
3. `FinalizationService`：Run → PaperRecord commit point → Run → Markdown；严格遵循 C07，Markdown 失败不回滚 Final。
4. `MarkdownSyncService`：Current Final → Markdown → PaperRecord sync 状态；不得改写 Final JSON。
5. `PaperLifecycleService`：6F 永久删除级联；不得删除已经退出 Lumer 管理范围的旧 Markdown。
6. `RecoveryService`：按 C02/C03/C07 的磁盘事实补偿 Import/Annotation journal、Run、PaperRecord 与 Markdown sync 状态；不得创建新的业务结论。

应用启动时由 `RecoveryService` 扫描 Import/Annotation journal、活动 Run 和 Markdown sync 状态，只通过对应 Repository/Store/Writer 补偿，不直接绕过底层 owner 改文件。

所有 Paper mutation（Metadata、Annotation、Chat、Analyze、Finalize、Markdown sync、Delete）必须经过 `PaperOperationCoordinator`。普通 mutation 持有该 Paper 的共享生命周期 lease；Delete 必须取得排他 lease 并在锁内重验 PaperRecord revision。所有 PaperRecord read-modify-write 还必须取得独立的 per-Paper write mutex 并在锁内重读；Annotation 从最终重读 Record 到 PDF/Record commit 全程持锁，禁止 Metadata/Final/Sync 交错写入。Import 由 `ImportCoordinator` 按 `source_sha256` 加锁并在锁内重新执行重复扫描。

### 4.11 正式 API 边界

- canonical API 路径、请求/响应 DTO、SSE 和错误码全部由 `docs/contracts/api.md` 冻结。
- 本节列出的 `src/app/api/**/route.ts` 是 canonical 路径到 Next.js App Router 的一一映射；不得同时保留第二组 legacy Folder/path-based 业务 API。
- UI 页面路由保持 `/`、`/reader/<paper_id>`、`/papers/<paper_id>/analysis/<run_id>`、`/settings`；业务 API 只使用 `paper_id/run_id`，不接受绝对路径。
- C01–C08 到模块、API、Schema、错误和测试的完整映射见 `docs/contracts/TRACEABILITY.md`。

---

## 5. 主要架构风险与控制

| 风险 | 控制 |
|---|---|
| CLI/Provider 输出变化 | Provider contract tests、prompt/schema version、一次 repair、失败保留 Draft |
| OpenAI-compatible 实现差异 | 5E 只依赖 `/models` 与非流式 `/chat/completions` 最小交集；响应不满足合同即明确失败，不增加供应商特例 |
| API Key 或 endpoint 泄露 | 只从服务端环境读取；不进入 UI/API/Vault/Run/日志；远程仅 HTTPS，禁止跨 origin 携凭据重定向 |
| 论文正文被发送到外部服务 | 仅在用户明确选择 `openai_compatible` 并启动概览时发送；UI 显示数据边界，状态检查不携带正文 |
| 全文超过参数或模型上下文 | Chat 使用版本化 `max_estimated_tokens=250,000` 总预算，超限在本地明确拒绝；该值不等同于外部 Provider 的稳定接受证明 |
| 模型伪造页码/引文 | 确定性页级 locator；失败不得 Final |
| Annotation 改变 PDF 二进制 | 身份使用持久化 `source_sha256`；Evidence 使用正文 `content_hash` |
| Annotation 被误当 Evidence | 提取测试明确排除 Annotation/Memo |
| Markdown 被用户修改 | `markdown_hash` + 取消/覆盖/另存 |
| Final commit 崩溃或 JSON 半写入 | PaperRecord 同目录 temp + flush/fsync + close + atomic rename；`finalizing` 按指针恢复 |
| Markdown 写入失败 | JSON Final 不回滚；持久化本次 `markdown_sync_context`，记录 `pending/error/conflict` 并提供可恢复的重试同步 |
| Vault 路径越界 | 所有业务路径必须在已验证 Vault 内解析，拒绝 `..`、绝对子路径和 symlink escape |
| 本地 API 暴露 | 只绑定 `127.0.0.1`，限制同源请求，不对局域网开放 |
| 无数据库扫描变慢 | V1 支持个人规模；实测超出可接受范围才返回 `/plan`，不预建数据库 |

---

## 6. 架构变更规则
- UI 固定规则由 `docs/frontend/` 管理。
- 本文描述模块职责，不决定批次先后；批次先后只以 `IMPLEMENTATION_PLAN.md` 为准。
