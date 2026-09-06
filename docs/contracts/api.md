# API & Error Contract

**覆盖合同**：C01–C08 的本地 HTTP/SSE 传输边界
**状态**：1C 已冻结；2026-09-04 C08 HTTP Overview 扩展已确认，2026-09-05 已批准第 7 阶段 HTTP Chat 与 Final Paper Card 门；实现批次见 `TRACEABILITY.md`

> 本文是正式 API 路径、请求/响应 DTO、并发字段、错误 envelope 与错误码的 Source of Truth。领域字段与状态不在本文重复定义：Storage 见 `storage.md`，Analysis/Evidence 见 `analysis.md`，Provider/Session 见 `provider.md`。

## 1. 通用传输规则

- 本地服务只监听 `127.0.0.1`；变更请求只接受同源请求。
- JSON 请求与响应使用 UTF-8、`application/json`；文件导入使用 `multipart/form-data`；流式 Chat/Analyze 使用 SSE。
- JSON 对象执行严格校验：未知字段、错误类型、非法 enum、非法 UUID、非法 revision 或非法路径均返回 `REQUEST_INVALID`，不得静默丢弃。
- 除 `PUT /api/settings` 的 `vault_path` 外，API 只接受领域 ID 和受限 DTO；不得接受 Vault/PDF 绝对路径、CLI 路径、HTTP Provider base URL/API Key/model、Token、权限参数或未列出的模型参数。
- 时间、ID、hash、相对路径与显式 `null` 规则继承 `storage.md`。
- HTTP 状态码表达传输结果；领域失败必须同时给稳定 `error.code`，UI 不解析英文 message 推断行为。

成功 envelope：

```json
{
  "data": {}
}
```

JSON API 使用该 envelope；SSE 使用第 2 节事件合同，PDF bytes 使用对应 MIME body，不再外包 JSON envelope。

失败 envelope：

```json
{
  "error": {
    "code": "PAPER_NOT_FOUND",
    "message": "未找到该论文。",
    "retryable": false,
    "stage": null,
    "details": null
  }
}
```

约束：

- `code` 必须来自第 5 节；`message` 是可显示的简体中文，不作为程序分支依据。
- `stage` 类型为 `analysis.md` 的 `AnalysisStage` 或 `null`。
- `details` 只允许对应错误码定义的安全字段；不得返回 stack、绝对路径、原始 CLI stderr、系统 Prompt、环境变量或凭据。
- 未知内部错误统一为 `INTERNAL_ERROR`，服务端保留诊断，响应不得泄露内部信息。

## 2. SSE 合同

每条 SSE 的 `data` 都是一个 JSON 对象：

```text
StreamEvent:
  event_id: Uuid
  type: stage | session | text_delta | thinking_delta | completed | failed | cancelled
  stage: AnalysisStage | null
  provider: codex | openai_compatible | null
  provider_session_id: string | null
  model: string | null
  text: string | null
  analysis_run: AnalysisRun | null
  error: ErrorEnvelope.error | null
```

- Chat 允许 `text_delta/thinking_delta`；Analyze 对产品 UI 只发送 `stage`、`completed`、`failed`、`cancelled`，不得发送或渲染半截结构化 JSON。
- Analyze 的 `completed` 必须在 `analysis_run` 返回完整 Preview 或 Draft/终态 Run；真实 Codex/OpenAI-compatible 概览返回只读 Preview，其他事件为 `null`。Chat 的所有事件均为 `null`。
- `completed`、`failed`、`cancelled` 三者之一必须且只能出现一次；终止事件后丢弃迟到事件。
- 网络中断不等于 Provider 任务成功；服务端按 C03 把无法恢复的活动 Run 转为 `interrupted`。
- SSE 中间事件不写入 AnalysisRun；Chat 仅在完整 assistant 消息结束后原子追加 Session。

## 3. 正式路由与职责

### 3.1 Settings / Provider

| 方法与路径 | 请求 | 成功响应 | 唯一职责 |
|---|---|---|---|
| `GET /api/settings` | 无 | `SettingsView` | 读取机器级非敏感配置与 Vault 校验状态；未配置也是成功状态 |
| `PUT /api/settings` | 完整 `LumerConfigInput` | `SettingsView` | 校验并原子替换配置；不迁移旧 Vault |
| `GET /api/providers` | 无 | `ProviderStatus[]` | 检测 Codex CLI 与 OpenAI-compatible HTTP Provider 的安全状态；不探测 Claude Code，不返回 HTTP 配置或凭据 |

`LumerConfigInput` 只允许 `vault_path`、`default_chat_provider`、`default_analyze_provider`；`schema_version` 由服务端写入。`default_chat_provider` 与 `default_analyze_provider` 均允许 `codex | openai_compatible | null`。自定义 Provider 配置通过独立的 `/api/provider-config` 路由写入 `~/.lumer/config.json`；旧 `/api/settings` 不接受 base URL、API Key、model 或任意凭据字段。

`GET /api/provider-config` 只返回服务名称、模型和配置状态等脱敏字段；`PUT /api/provider-config` 保存用户主动提交的 App、Base URL、模型和 API Key；`DELETE /api/provider-config/api-key` 清除本机 API Key。任何响应、错误、日志、SSE 或 ProviderStatus 均不得回显 API Key 或 Authorization。

```text
ProviderConfigView:
  app: non-empty string | null
  model: non-empty string | null
  base_url_configured: boolean
  has_api_key: boolean
  config_file_present: boolean
```

`PUT` 至少包含 `app`、`base_url`、`model`，`api_key` 可省略或为空以保留已有 Key；清除 Key 只能使用专用 `DELETE`。配置文件不存在时返回 `CONFIG_NOT_INITIALIZED`，要求先完成基础 Settings 保存。保存成功后，Provider 状态和后续请求立即从最新 `config.json` 读取；未建立 schema 2 Provider 对象时继续兼容旧环境变量回退。

```text
ProviderStatus:
  provider: codex | openai_compatible
  transport: cli | http
  configured: boolean
  installed: boolean | null
  authenticated: boolean | null
  available: boolean
  detected_model: non-empty string | null
  failure_code: PROVIDER_NOT_CONFIGURED | PROVIDER_NOT_INSTALLED | PROVIDER_NOT_AUTHENTICATED | PROVIDER_UNAVAILABLE | null
```

- HTTP Provider 状态检查不得发送论文正文；响应不得含 base URL、请求头、API Key 或上游错误正文。
- `installed=null` 只用于 HTTP transport；Codex CLI 仍返回明确 installed/authenticated 布尔值。

```text
SettingsView:
  config: LumerConfig | null
  vault_status: unconfigured | valid | unavailable | permission_denied
  obsidian_initialized: boolean | null
```

未配置时 `config=null`、`vault_status=unconfigured`、`obsidian_initialized=null`；`.obsidian/` 不存在时仍可为 `valid`，只把 `obsidian_initialized` 设为 `false`。

### 3.2 Paper / Import / PDF / Annotation

| 方法与路径 | 请求 | 成功响应 | 唯一职责 |
|---|---|---|---|
| `GET /api/papers` | query: `search?`, `status?`, `tag?` | `PaperSummary[]` | 扫描并筛选 PaperRecord，并只读聚合每篇论文最近可进入的 AnalysisRun 摘要；不修改数据 |
| `POST /api/papers/import` | multipart 单个 `file` | `ImportPaperResult` | 校验、SHA-256 去重、提取、原子写 PDF/PaperRecord/Extraction |
| `GET /api/papers/[paperId]` | 无 | `PaperDetail` | 聚合同一 Paper 的 Record、Current Final 摘要与可用状态 |
| `PATCH /api/papers/[paperId]` | `PaperMetadataPatch` | `PaperRecord` | 仅修改 Metadata、Tags、Status；要求 `expected_record_revision` |
| `DELETE /api/papers/[paperId]` | `DeletePaperRequest` | `DeletePaperResult` | 6F 才实现永久级联删除；一次请求完成合同内所有受管对象 |
| `GET /api/papers/[paperId]/pdf` | 无 | PDF bytes | 由 `paper_id` 解析 canonical PDF；持有共享 PDF read lock，不接受 path query |
| `GET /api/papers/[paperId]/annotations` | 无 | `PdfAnnotation[]` | 持有共享 PDF read lock，读取该托管 PDF 的原生 Highlight/Memo |
| `POST /api/papers/[paperId]/annotations` | `CreateAnnotationRequest` | `AnnotationMutationResult` | 创建一个原生 Annotation |
| `PATCH /api/papers/[paperId]/annotations/[annotationId]` | `UpdateAnnotationRequest` | `AnnotationMutationResult` | 只修改该 Annotation 的 type/note/text 合同字段 |
| `DELETE /api/papers/[paperId]/annotations/[annotationId]` | `DeleteAnnotationRequest` | `AnnotationMutationResult` | 删除一个原生 Annotation |

```text
PaperSummary:
  paper: PaperRecord
  has_current_final: boolean
  latest_analysis: LatestAnalysisSummary | null

LatestAnalysisSummary:
  analysis_run_id: Uuid
  state: preview | draft | finalizing | finalized
  provider: codex | openai_compatible
  model: non-empty string
  updated_at: UtcDateTime

PaperDetail:
  paper: PaperRecord
  extraction_available: boolean
  current_final: CurrentFinalSummary | null

CurrentFinalSummary:
  analysis_run_id: Uuid
  state: finalizing | finalized
  finalized_at: UtcDateTime | null
  provider: codex
  model: non-empty string

ImportPaperResult:
  paper: PaperRecord
  duplicate: boolean

PaperMetadataPatch:
  expected_record_revision: integer >= 1
  title?: non-empty string
  authors?: string[]
  year?: integer | null
  journal?: string | null
  doi?: string | null
  tags?: string[]
  status?: inbox | reading | read

DeletePaperRequest:
  expected_record_revision: integer >= 1
  confirmed_paper_id: Uuid

DeletePaperResult:
  paper_id: Uuid
  deleted_managed_paths: VaultRelativePath[]

PdfAnnotation:
  annotation_id: non-empty string
  pdf_page_index: integer >= 0
  display_page_number: integer >= 1
  type: important | unknown
  text: non-empty string
  note: string
  rects: { x: number, y: number, width: number, height: number }[]

CreateAnnotationRequest:
  expected_record_revision: integer >= 1
  pdf_page_index: integer >= 0
  type: important | unknown
  text: non-empty string
  note: string
  rects: normalized non-empty rectangle array

UpdateAnnotationRequest:
  expected_record_revision: integer >= 1
  type?: important | unknown
  text?: non-empty string
  note?: string

DeleteAnnotationRequest:
  expected_record_revision: integer >= 1

AnnotationMutationResult:
  annotation: PdfAnnotation | null
  deleted: boolean
  paper: PaperRecord
```

`CurrentFinalSummary.provider` 在 5E–5F 仍固定为 `codex`：OpenAI-compatible 只产生 `preview`，不能成为 Final，也不改变 PaperRecord 的 Current Final 指针。

- `ImportPaperResult.duplicate=true` 是成功响应，不使用错误码；重复导入不得写任何文件。
- Annotation rectangle 的四个数必须有限、在 `[0,1]` 内，且 `x+width<=1`、`y+height<=1`。
- PDF/Annotation 读取在共享 PDF read lock 内校验磁盘 SHA-256 等于 `managed_pdf_sha256`；不等时返回 `PDF_REPLACED`，不得读取或修改未受管字节。
- Annotation 写入在排他 PDF write lock 内先校验 `managed_pdf_sha256`，写入后必须重验正文 `content_hash` 不变；失败视为数据完整性错误，不更新 Extraction 或 PaperRecord。
- `PaperMetadataPatch` 除 revision 外至少包含一个变更字段；`UpdateAnnotationRequest` 除 `expected_record_revision` 外至少包含一个变更字段，否则返回 `REQUEST_INVALID`。
- `CurrentFinalSummary.state=finalizing` 时 `finalized_at=null`；`state=finalized` 时 `finalized_at` 必须非空。前者只允许出现在 C07 commit point 后、Recovery 补写前；UI 必须显示“已提交，正在恢复”，不得把它当作未提交或旧 Final。
- Annotation 创建/更新返回 `annotation!=null/deleted=false`；删除返回 `annotation=null/deleted=true`。返回的 PaperRecord 含递增后的 `record_revision/pdf_revision` 与新 `managed_pdf_sha256`。

### 3.3 Chat

| 方法与路径 | 请求 | 成功响应 | 唯一职责 |
|---|---|---|---|
| `GET /api/papers/[paperId]/chat?provider=...` | Provider query | `ChatSession \| null` | 读取 Paper × Provider 的自由 Chat 历史 |
| `POST /api/papers/[paperId]/chat` | `ChatRequest` | SSE | 新建/续接自由 Chat，完成后原子保存完整消息 |

```text
ChatRequest:
  provider: codex | openai_compatible
  message: non-empty string
  selected_text: string | null
  intent: free_chat | explain_selection | translate_selection
```

- `explain_selection/translate_selection` 要求 `selected_text` 非空。
- GET 与 POST 均须在 Route 之外由 ChatService 强制验证：PaperRecord 的 `current_final_run_id` 非空且指向同 Paper 的 `finalized` Run。否则返回 `PAPER_CARD_REQUIRED`，不得读取历史、调用 Provider 或写入 Session。
- `current_final_run_id` 是 Final Paper Card 的唯一程序门；`preview`、`draft`、`finalizing` 或仅有 `latest_analysis` 均不满足条件，Markdown sync 状态不另作 Chat 门。
- `openai_compatible` Chat 每次都是新 HTTP task；其历史只用于下一次应用侧 prompt 组装，绝不作为 provider session resume。
- Chat 不接受 `analysis_run_id`，不写 PaperAnalysis/Evidence/AnalysisRun。
- `ChatService` 对同一 Paper 的任一 Provider Chat task 和 Session commit 持有独占 lease；第二个并发请求返回 `CHAT_ALREADY_ACTIVE`。
- 只有 Provider 成功结束且 user/assistant 完整消息对已原子写入 Session 后才发送 SSE `completed`；Provider 或 Session 写入失败不得发送伪完成事件。

### 3.4 AnalysisRun / Final / Markdown

| 方法与路径 | 请求 | 成功响应 | 唯一职责 |
|---|---|---|---|
| `GET /api/analysis-runs?paper_id=...` | `paper_id` query | `AnalysisRun[]` | 读取单 Paper 的 Run 历史 |
| `GET /api/analysis-runs/active` | 无 | `AnalysisRun \| null` | 读取全局活动 Run，不创建状态 |
| `POST /api/analysis-runs` | `CreateAnalysisRunRequest` | SSE，终止时给完整 `AnalysisRun` | 原子占用全局槽位并由明确 Provider 执行概览→Preview；结构化 Draft 链仍只保留给 Codex fixture/兼容路径 |
| `GET /api/analysis-runs/[runId]` | 无 | `AnalysisRun` | 读取一个 Run |
| `PATCH /api/analysis-runs/[runId]` | `SaveDraftRequest` | `AnalysisRun` | 仅保存 Draft 并重新计算受影响 Evidence/Gate |
| `POST /api/analysis-runs/[runId]/cancel` | 无 | `AnalysisRun` | 仅允许取消 `running` Run |
| `POST /api/analysis-runs/[runId]/retry` | `RetryRunRequest` | SSE | 用户 Retry 创建新 Run，并写 `retry_of_run_id` |
| `POST /api/analysis-runs/[runId]/derive-draft` | 无 | `AnalysisRun` | 从 `finalized` Run 复制新 Draft，并写 `derived_from_run_id` |
| `POST /api/analysis-runs/[runId]/verify` | `VerifyEvidenceRequest` | `AnalysisRun` | 对 Draft 执行确定性 Evidence Verification/Gate |
| `POST /api/analysis-runs/[runId]/finalize` | `FinalizeRunRequest` | `FinalizeRunResult` | 执行 C07 preflight、commit point、Final 与首次 Markdown sync |
| `POST /api/analysis-runs/[runId]/sync-markdown` | `SyncMarkdownRequest` | `PaperRecord` | 只重试 Current Final 的 Markdown 派生输出，不改 Final JSON |
| `POST /api/analysis-runs/[runId]/accept-metadata` | `AcceptMetadataCandidateRequest` | `PaperRecord` | 用户明确接受该 Run 的 Candidate 后更新非空 Metadata 字段；不修改 Run 或触发 Final |

```text
CreateAnalysisRunRequest:
  paper_id: Uuid
  provider: codex | openai_compatible

SaveDraftRequest:
  expected_draft_revision: integer >= 1
  paper_analysis: EditablePaperAnalysis

RetryRunRequest:
  provider: codex | openai_compatible

VerifyEvidenceRequest:
  expected_draft_revision: integer >= 1

FinalizeRunRequest:
  expected_draft_revision: integer >= 0  # 概览为 0，结构化 Draft 至少为 1
  expected_paper_record_revision: integer >= 1
  markdown_action: create | overwrite | save_as
  expected_markdown_hash: Sha256 | null

FinalizeRunResult:
  run: AnalysisRun
  paper: PaperRecord
  committed: true
  recovery_required: boolean

SyncMarkdownRequest:
  expected_paper_record_revision: integer >= 1
  markdown_action: create | overwrite | save_as
  expected_markdown_hash: Sha256 | null

AcceptMetadataCandidateRequest:
  expected_draft_revision: integer >= 1
  expected_paper_record_revision: integer >= 1
```

- `retry` 的 Provider 必须等于原 Run；不得借 Retry fallback。`openai_compatible` 只可 Retry 原 `preview/failed/cancelled/interrupted` 概览 Run，不得进入 Draft/Verify/Final 路径。
- `PATCH` 仅接受 `draft`；修改 Finding claim、Evidence quote 或页码时，服务端只把相关 Evidence 置回 pending 并重算 Gate，不运行 locator；返回的 `draft_revision` 递增一次。
- `verify` 不调用 Provider、不改变 Run state；它原子更新 Evidence/Gate，返回的 `draft_revision` 再递增一次。
- `verify` 中的 `ambiguous/not_found/content_hash_mismatch` 是成功完成的领域验证结果：返回 HTTP 200 和更新后的 Run/Gate，不转换为请求错误；只有 Finalize preflight 发现正文 hash 不一致或试图绕过失败 Gate 时，才分别返回 `CONTENT_HASH_MISMATCH`、`EVIDENCE_GATE_FAILED`。
- `finalize` 的冲突选择必须在进入 `finalizing` 前确定；“取消”由客户端不发请求表达。
- `cancel` 只允许 `running` Run；它原子结束当前 attempt 并写入 `cancelled`，不创建 Draft、Final 或 Retry。Provider 迟到的结果不得覆盖该终态。
- `preview` 是 Codex/API 完整概览的只读结果；不接受 Draft、Verify 或 Metadata Candidate 写入。用户点击“同步到 Obsidian”调用既有 Finalize API，`expected_draft_revision=0`，按 `unstructured-text-v1` 进入概览 Final 提交分支；不调用 Provider、不要求 Evidence Gate。结构化 Draft 的 Finalize Gate 保持。Markdown 冲突、版本冲突、原子提交和同步重试复用既有合同。
- `sync-markdown` 只允许 PaperRecord 的 Current Final；执行任何 Markdown I/O 前，服务端必须先用请求选择构造并原子保存新的 `MarkdownSyncContext`，Markdown 失败不得改写或回滚 AnalysisRun。
- `accept-metadata` 只允许含有 `paper_analysis` 的 `draft/finalized` Run；它从服务端保存的 Candidate 读取数据，客户端不得提交或改写 Candidate 字段。Candidate 中 `null`、空白字符串或空作者列表不覆盖既有 PaperRecord；没有任何可接受字段时返回 `METADATA_CANDIDATE_EMPTY`。
- commit point 前失败使用 error envelope；commit point 后即使 `Run → finalized` 或 Markdown 写入失败，若连接仍可响应也必须返回 HTTP 200、`committed=true`。Run 仍为 `finalizing` 时设 `recovery_required=true`；客户端重新读取 Current Final，绝不能按失败重提交流程。

## 4. 并发、revision 与状态拒绝

- 所有写 PaperRecord 的 API 必须带 `expected_record_revision` 或由 `FinalizeRunRequest` 带等价字段；不匹配返回 `PAPER_RECORD_REVISION_CONFLICT`。
- 所有 PaperRecord read-modify-write 在 per-Paper write mutex 内最终重读并提交；Annotation 从该重读跨 PDF rename 持锁到 Record commit，Metadata/Finalization/Markdown sync/Recovery 不得交错覆盖。
- Draft 保存、Evidence Verify、Finalize 必须带 `expected_draft_revision`；不匹配返回 `DRAFT_REVISION_CONFLICT`。
- Analyze Coordinator 对创建 `running` 与 Draft 进入 `finalizing` 共用同一个全局活动锁并执行原子 check；第二个 Analyze/Finalize 请求返回 `ANALYZE_ALREADY_ACTIVE` 和安全 details：`active_run_id`、`active_paper_id`。
- 每个 Paper mutation 都必须取得 lifecycle lease；Delete 取得排他 lease，存在 Chat/Analyze/Annotation/Final/Sync 等在途 mutation 时返回 `PAPER_BUSY`，持锁期间禁止新 mutation 进入。
- Delete 在排他 lease 内必须先恢复/清空该 Paper 的 Import/Annotation journal；仍不一致时返回 `DATA_INTEGRITY_ERROR`，不得继续级联。
- Settings 切换 Vault 必须取得全局 exclusive Vault lease；存在任何在途 mutation 时返回 `VAULT_BUSY`。
- 状态不允许执行某动作时返回 `RUN_STATE_INVALID`，不得静默 no-op 或创建旁路状态。
- 客户端断线、重复点击或重试不得绕过 revision、全局活动 Run、Evidence Gate、Markdown 二次 hash 检查。

## 5. 错误码目录

| 错误码 | HTTP | retryable | 所有者/安全 details |
|---|---:|---:|---|
| `REQUEST_INVALID` | 400 | false | API；仅返回字段级问题，不回显敏感输入 |
| `ORIGIN_FORBIDDEN` | 403 | false | API 安全边界；无 details |
| `VAULT_NOT_CONFIGURED` | 409 | false | 需要业务 Vault 的 API；引导 Settings |
| `VAULT_PATH_INVALID` | 422 | false | Config；`reason` 可为 `not_absolute/not_found/not_directory` |
| `VAULT_UNAVAILABLE` | 503 | true | Config；无绝对路径 |
| `VAULT_PERMISSION_DENIED` | 403 | false | Config；无绝对路径 |
| `VAULT_BUSY` | 409 | true | Settings；仅返回安全的活动 operation kinds |
| `VAULT_ALREADY_OPEN` | 409 | true | Bootstrap/Settings；目标 Vault 已被另一个 Lumer 进程持锁 |
| `CONFIG_WRITE_FAILED` | 500 | true | Config；无内部文件名 |
| `CONFIG_NOT_INITIALIZED` | 409 | false | Provider Config；要求先完成基础 Settings，不返回路径 |
| `PATH_OUTSIDE_VAULT` | 400 | false | Storage；无解析后的绝对路径 |
| `SCHEMA_VERSION_UNSUPPORTED` | 409 | false | Repository；`schema_version`、`supported_versions` |
| `DATA_INTEGRITY_ERROR` | 500 | false | Recovery/Repository；仅返回受影响对象类别与领域 ID，不返回内容或绝对路径 |
| `PAPER_NOT_FOUND` | 404 | false | Paper Repository；`paper_id` |
| `PAPER_CARD_REQUIRED` | 409 | false | Chat；`paper_id`；提示先完成并保存 Final Paper Card，不泄露 Run 内容 |
| `CHAT_CONTEXT_LIMIT_EXCEEDED` | 413 | false | Chat；仅返回 `limit` 与 `actual`，不返回正文 |
| `PAPER_RECORD_REVISION_CONFLICT` | 409 | true | Paper Repository；`expected_revision`、`actual_revision` |
| `PAPER_BUSY` | 409 | true | Paper lifecycle；`paper_id`、安全的活动 operation kinds |
| `PDF_INVALID_EXTENSION` | 422 | false | Import；无 details |
| `PDF_INVALID_HEADER` | 422 | false | Import；无 details |
| `PDF_ENCRYPTED` | 422 | false | PDF Support；无 details |
| `PDF_SCANNED` | 422 | false | PDF Support；无 details |
| `PDF_CORRUPT` | 422 | false | PDF Support；无 details |
| `PDF_LIMIT_EXCEEDED` | 413 | false | PDF Support；仅返回 `limit_kind`、`limit`、`actual` |
| `PDF_MISSING` | 409 | false | Reader；`paper_id` |
| `PDF_REPLACED` | 409 | false | Reader/Repository；磁盘 PDF SHA-256 与 `managed_pdf_sha256` 不一致，details 仅含 `paper_id` |
| `ANNOTATION_NOT_FOUND` | 404 | false | Annotation；`annotation_id` |
| `ANNOTATION_WRITE_FAILED` | 500 | true | Annotation；仅 canonical PDF rename 前使用，无 PDF 绝对路径 |
| `PROVIDER_NOT_CONFIGURED` | 422 | false | HTTP Provider 环境配置；`provider`，不得返回缺失变量名以外的值 |
| `PROVIDER_NOT_INSTALLED` | 503 | false | CLI Provider；`provider` |
| `PROVIDER_NOT_AUTHENTICATED` | 401 | false | Provider；`provider` |
| `PROVIDER_UNAVAILABLE` | 503 | true | Provider；`provider` |
| `PROVIDER_PROTOCOL_ERROR` | 502 | true | Provider Adapter；`provider`，不返回原始 CLI/API 输出、endpoint 或 headers |
| `PROVIDER_OUTPUT_INVALID` | 422 | false | Structured Output；`run_id`、安全 Schema issue 摘要 |
| `CHAT_ALREADY_ACTIVE` | 409 | true | Chat；`paper_id`、`provider` |
| `SESSION_WRITE_FAILED` | 500 | true | Chat/Session Repository；`paper_id`、`provider`，不返回消息正文 |
| `ANALYZE_ALREADY_ACTIVE` | 409 | true | Analyze Coordinator；`active_run_id`、`active_paper_id` |
| `RUN_NOT_FOUND` | 404 | false | Analysis Repository；`run_id` |
| `RUN_STATE_INVALID` | 409 | false | Analysis Service；`run_id`、`state`、`action` |
| `DRAFT_REVISION_CONFLICT` | 409 | true | Analysis Repository；`expected_revision`、`actual_revision` |
| `METADATA_CANDIDATE_EMPTY` | 422 | false | Metadata Candidate；`run_id` |
| `CONTENT_HASH_MISMATCH` | 409 | false | Evidence/Final；`paper_id`、`run_id` |
| `EVIDENCE_GATE_FAILED` | 422 | false | Evidence Gate；`run_id`、失败 finding IDs/reasons |
| `FINAL_COMMIT_FAILED` | 500 | true | Final Service；`run_id`；只用于 commit point 前失败 |
| `MARKDOWN_CONFLICT` | 409 | false | Markdown；`card_path` 仅返回 Vault-relative path 与 hash |
| `MARKDOWN_WRITE_FAILED` | 500 | true | Markdown；仅返回 Vault-relative path |
| `DELETE_FAILED` | 500 | true | Paper lifecycle；只返回未完成的受管对象类别 |
| `INTERNAL_ERROR` | 500 | true | API boundary；无 details |

## 6. API 不变量

- 路由 handler 只做同源检查、解析、DTO 校验、调用 application service 和映射响应；不得直接操作 Vault、Provider CLI 或跨 Repository 提交。
- Repository 不生成用户文案、不调用 Provider、不决定 Evidence Gate；Service 不绕过 Repository 直接写 JSON。
- API 失败不得返回部分成功对象。C07 commit point 后不再使用失败 envelope：`FinalizeRunResult` 以 `committed/recovery_required` 和 PaperRecord 的 `markdown_sync_status` 表达 Run/Markdown 后续恢复状态。
- 任何 `404/409/422/5xx` 都不得让客户端凭本地状态假定写入成功；必须重新读取受影响资源。
