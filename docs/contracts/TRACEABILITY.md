# C01–C08 Traceability

**版本**：v1.2（2026-09-05 Final Paper Card 门控 Chat 扩展）
**状态**：已确认；5E–5F 代码已实施，7A–7D 为批准后的 Chat 扩展计划

> 本文证明每项已确认合同都有唯一 Source of Truth、领域对象、模块 owner、API、错误语义、测试责任和后续实施批次。任何一列发生实质改变都必须先返回 `/plan`。

## 1. 合同端到端映射

| 合同 | 规则 Source of Truth | Schema / 字段 | 写入 owner 与核心模块 | 正式 API | 主要错误码 | 自动测试责任 | 实施批次 |
|---|---|---|---|---|---|---|---|
| C01 配置/业务/可见产物分离 | `storage.md` §0–3 | `LumerConfig`、`VaultContext`、Vault layout、`VaultRelativePath`、runtime lock | `SettingsService`、`VaultOperationCoordinator`、`VaultRuntimeLock`、Config Repository/path guard | `GET/PUT /api/settings` | `VAULT_NOT_CONFIGURED`、`VAULT_*`、`CONFIG_WRITE_FAILED`、`PATH_OUTSIDE_VAULT` | Unit：config/path schema；Integration：atomic save、在途 mutation 拒绝切换、跨进程 lock、切换失败保旧 context、symlink escape；E2E：onboarding/restart | 2A–2B |
| C02 命名、身份与重名 | `storage.md` §4–6 | `PaperRecord.paper_id/source_sha256/managed_pdf_sha256/pdf_revision/pdf_path/card_path`、`ExtractedPaper`、Import/Annotation Operation | Import/Annotation/Metadata Candidate Service、Coordinators、ManagedPdfStore、Paper/Extraction/Operation Repository | Import、Paper、Annotation、accept-metadata API | `PDF_*`、`PAPER_*`、`METADATA_CANDIDATE_EMPTY`、`DATA_INTEGRITY_ERROR` | Unit：safe name/hash/page contract；Integration：并发同 hash 去重、journal-before-temp 全崩溃窗口、Annotation×其他 Record writer 串行、原子替换后正文身份不变、外部同正文替换拒绝、Candidate 仅经用户确认写入 | 2B–2D、3B、4G、6B、6C |
| C03 Run 状态机与全局单活动 | `analysis.md` §1 C03 | `AnalysisRun.state/draft_revision/retry_of_run_id/attempts` | `AnalyzeCoordinator`、Codex/Mock Analysis、`AnalysisRunControlService`、Finalization/Recovery Service、`AnalysisRunRepository` | `/api/analysis-runs`、`active`、`[runId]`、`cancel`、`retry`、`finalize` | `ANALYZE_ALREADY_ACTIVE`、`RUN_*`、`DRAFT_REVISION_CONFLICT` | Unit：全部合法/非法转换；Integration：Analyze/Finalize 同锁竞争、取消/流中断/启动恢复、迟到 Provider 结果与用户新 Retry | 4A、5D、6A、6D |
| C04 Final immutable | `analysis.md` §1 C04 | `state=finalized` snapshot、`derived_from_run_id`、nullable derived Session、`PaperRecord.current_final_run_id` | `FinalizationService`、`AnalysisRunRepository`、`PaperRepository` | `derive-draft`、`finalize`、Run history | `RUN_STATE_INVALID`、revision conflicts | Unit：终态不可写、derive copy/ID/Session provenance；Integration：旧 Final 保留、重新 Analyze 不改 Current Final | 4E–4F、6A |
| C05 Finding Gate | `analysis.md` §2 | `PaperAnalysis`、`Finding`、`EvidenceGate` | `EvidenceService`、纯 `FindingGate`；Finalization 只消费结果 | `PATCH [runId]`、`verify`、`finalize` | `EVIDENCE_GATE_FAILED`、`CONTENT_HASH_MISMATCH` | Unit：每 Finding ≥1 verified、所有保留 Evidence verified、无 Finding、编辑失效；Component：无绕过入口 | 4D–4F |
| C06 Evidence locator/normalize | `analysis.md` §3–4 | `Evidence`、span、页码、normalization steps、`content_hash` | 纯 `normalize-text/locate-quote`、`EvidenceService` | `verify`；Reader Evidence 回跳使用同一 DTO | expected `ambiguous/not_found/hash mismatch` 写入 Evidence/Gate；Finalize preflight 使用 `CONTENT_HASH_MISMATCH` | Unit：exact/normalized/全文唯一/歧义/零命中/跨页/offset；Integration：Annotation 不入正文、hash mismatch 全部 pending | 4B–4D |
| C07 崩溃安全 Final commit/Markdown | `storage.md` §7、`analysis.md` 的 `FinalizationContext` | `current_final_run_id`、revision、`markdown_*`、`MarkdownSyncContext`、`finalization_context` | `FinalizationService`、`MarkdownSyncService`、`RecoveryService`、`MarkdownWriter`、两个 Repository | `finalize`、`sync-markdown` | `FINAL_COMMIT_FAILED`、`MARKDOWN_CONFLICT`、`MARKDOWN_WRITE_FAILED`、revision conflicts | Unit：Renderer 确定性；Integration：commit point 前后故障、Run 写失败成功响应、首次/后续 sync 的 Markdown rename 后 Record 写前崩溃、三冲突分支、二次 hash、sync retry | 4F–4G、6C、6E |
| C08 Provider/Session/task/无伪 fallback | `provider.md` §1–3 | `ChatProvider`、`AnalyzeProvider`、`ProviderStatus`、`ChatSessionStore.session_revision`、双 Provider 槽位、Adapter DTO、Run 的 provider/model/session-or-task/version | `ChatService` task lease、`PaperChatContextBuilder`、Session Repository、Provider Registry、Codex CLI Adapter、OpenAI-compatible HTTP Adapter；Analysis Service 只调用 port | Provider、Final 后 Codex/HTTP Paper Chat、创建/Retry Run | `PAPER_CARD_REQUIRED`、`CHAT_CONTEXT_LIMIT_EXCEEDED`、`PROVIDER_*`、`CHAT_ALREADY_ACTIVE`、`SESSION_WRITE_FAILED`、`PROVIDER_OUTPUT_INVALID` | Contract：Codex/HTTP adapter、任务支持矩阵、SSE；Integration：无 Final 拒绝、同 Paper Chat 并发、正文身份、双 Provider 历史隔离、Chat/Analyze/derive 隔离、HTTP no-resume/no-fallback；Component：Final 前隐藏 Chat、Provider 选择与 Claude Code 禁用；Live Smoke：两个 Provider 各自报告 Overview/Chat provenance | 5A–5F、7A–7D、8C |

## 2. 持久化字段归属审计

| 持久化对象/字段组 | 规则 owner | 底层写入 owner | 读取者 | 禁止行为 |
|---|---|---|---|---|
| `LumerConfig` 全部字段 | C01 | `LumerConfigRepository` | Settings、启动/bootstrap、Provider 默认选择 | 保存凭据、HTTP base URL/model、任意生成参数或业务记录 |
| `PaperRecord` 身份/路径/Metadata/Status | C02 | `PaperRepository`，Metadata 由 PaperLibrary/Metadata Candidate Service 发起 | Library、Reader、Import、Analyze、Final | Analyze/Final 自动将 Candidate 写入 Metadata；以标题/文件名替代 `paper_id/source_sha256` |
| `PaperRecord.managed_pdf_sha256/pdf_revision` | C02/Annotation integrity | `PaperRepository`，由 Import（仅初始化）/Annotation/Recovery 发起 | Reader、Annotation、Import、Recovery | 用 `source_sha256` 判断 Annotation 后当前字节身份 |
| `PaperRecord.current_final_run_id` 与 `markdown_*` | C04/C07 | `PaperRepository`，由 Finalization/MarkdownSync/Recovery 发起 | Library、Analysis、Recovery | UI/Markdown Writer 直接改指针或只在内存保存 sync context |
| `ExtractedPaper` 全部字段 | C02/C06 | `ExtractionRepository` | Reader support、Analyze、Evidence | Annotation/模型输出进入正文 |
| `ImportOperation` 全部字段 | C02 recovery | `ImportOperationRepository` | Import/Recovery Service | 无 journal 猜测删除孤儿文件 |
| `AnnotationOperation` 全部字段 | C02 recovery | `AnnotationOperationRepository` | Annotation/Recovery Service | PDF rename 后无 journal 猜测 PaperRecord hash |
| `AnalysisRun` 状态/revision/attempt/error | C03 | `AnalysisRunRepository` | Analyze UI、Coordinator、Recovery | Route/Provider 直接改状态 |
| `AnalysisRun.paper_analysis/evidence_gate` | C05/C06 | `AnalysisRunRepository`，由 Analysis/Evidence Service 发起 | Editor、Finalization、Renderer | Zod 通过即视为 Gate 通过 |
| `AnalysisRun` Final snapshot/context/history | C04/C07 | `AnalysisRunRepository`，由 Finalization/Recovery 发起 | Current Final、History、Markdown Renderer | 修改历史 Final 或增加 `superseded` 状态 |
| `AnalysisRun` provider/model/session-or-task/version/raw/attempts | C08/C03 | `AnalysisRunRepository`，由 Analysis Service 发起 | 审计、History、Retry | 猜测 model、保存 endpoint/凭据、把 HTTP task ID 当可续接 Session、静默 fallback |
| `ChatSessionStore` 全部字段 | C08 | `SessionRepository` | Final 后 Codex / HTTP Chat Service/UI | Analysis 使用、跨 Provider 共享 Session 或把 HTTP task ID 用作 resume |
| `.lumer/runtime.lock` | C01 process isolation | `VaultRuntimeLock` | Bootstrap/Settings | 未持锁访问业务 Repository |
| PDF Annotation | Reader 边界 + C02/C06 invariant | `PdfAnnotationWorker` | Reader、Annotation UI | Annotation 内容进入 Extraction/Evidence |
| Paper Card Markdown | C07 | `MarkdownWriter` | Obsidian/用户、只读预览 | 反向解析修改 JSON |

审计结论：正式持久化对象不存在无规则 owner、无底层写入 owner 或无测试责任的字段组。

## 3. API 到实现边界

| API 组 | Route 允许做什么 | 必须调用 | 不得做什么 |
|---|---|---|---|
| Settings | 同源、DTO 校验、响应映射 | `SettingsService` | 直接写 home config |
| Paper/Import | multipart/query/patch 校验 | Paper/Import/Lifecycle Service | 接受绝对业务路径、跨文件手工提交 |
| PDF/Annotation | 校验 `paper_id`/Annotation DTO | Reader/Annotation Service | 由请求 path 打开任意 PDF |
| Chat/Provider | Final Paper Card 门、明确 ChatProvider、Provider 状态与 SSE 映射 | `ChatService`/`PaperChatContextBuilder`/Provider status service | 接受 endpoint/key/model、fallback、写 AnalysisRun、无 Final 时调用 Provider |
| AnalysisRun | revision/动作 DTO、SSE 映射 | Coordinator/Analysis/Evidence/Finalization Service | Route 内决定状态、Gate 或 commit point |
| Markdown Sync | revision/冲突选择 DTO | `MarkdownSyncService` | 解析 Markdown 回写 JSON |

## 4. 变更门

以下任一变化必须停止实施并返回 `/plan`：

- 新增数据库、队列、云存储或第二个业务数据根。
- 改变任一 C01–C08 状态、Gate、定位、身份、commit point、Provider 隔离或 fallback 规则。
- 让 API 接受任意绝对业务路径，或让 Route/UI/Adapter 直接写持久化文件。
- 新增未归属到领域合同、错误码、测试责任和实施批次的持久化字段。
- 为通过测试而把 Mock、单 Provider、Zod 或页面可打开报告为完整能力。
