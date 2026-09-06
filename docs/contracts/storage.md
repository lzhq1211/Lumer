# Storage Contract

**覆盖合同**：C01、C02、C07（存储/提交部分）
**状态**：已确认；`default_analyze_provider` 扩展与 5F Provider 选择代码已实现；7A–7D 已批准将双 Provider Chat Session 纳入 schema 1 兼容迁移

> 本文是配置、Vault、文件身份、PaperRecord、ExtractedPaper、Markdown 派生输出与原子持久化的 Source of Truth。

## 0. JSON 序列化与基础类型

本合同中的持久化对象统一遵循以下规则；2B 才实现可执行 Schema 和迁移器，1C 只冻结合同：

- 文件编码固定为 UTF-8 JSON；对象必须通过对应 `schema_version` 的严格 Schema，未知字段不得静默写回。
- 表中字段默认全部必填；允许空值的字段明确写为 `null`，不得用字段缺失或 `undefined` 表示。
- `Uuid`：小写 canonical UUID 字符串。
- `Sha256`：64 位小写十六进制字符串。
- `UtcDateTime`：带 `Z` 的 RFC 3339 UTC 字符串。
- `VaultRelativePath`：相对已验证 Vault 根目录的 POSIX 路径；不得以 `/` 开头，不得包含 `.`、`..`、NUL 或 symlink escape。
- revision 为大于等于 `1` 的整数；新对象从 `1` 开始，每次成功原子写入后递增一次。
- 数组没有内容时写 `[]`；业务上唯一的 ID、路径、Tag 或 Annotation ID 不得重复。

## 1. C01 应用配置与业务数据边界

合同 C01 已确认：配置目录和 Vault 内隐藏业务目录统一使用 `.lumer`。

```text
~/.lumer/
└── config.json
```

`config.json` 最小字段：

```json
{
  "schema_version": 2,
  "vault_path": "/absolute/path/to/Vault",
  "default_chat_provider": null,
  "default_analyze_provider": null,
  "openai_compatible": null
}
```

字段合同：

| 字段 | 类型 | 规则 |
|---|---|---|
| `schema_version` | `1 \| 2` | 旧 schema 1 可读；schema 2 保存自定义 Provider 配置；其他版本拒绝读取并进入配置修复 |
| `vault_path` | absolute path string | 必须通过本节的存在性、目录和读写验证 |
| `default_chat_provider` | `codex \| openai_compatible \| null` | 非敏感默认值；按 Provider 分别保存 Chat 历史 |
| `default_analyze_provider` | `codex \| openai_compatible \| null` | 默认值；旧 schema 1 配置继续兼容 |
| `openai_compatible` | object \| null | schema 2 的本机 Provider 配置；包含 `app`、`base_url`、`model`、`api_key`，API Key 只存本机配置文件且不向接口回显 |

保存前必须验证：

- 路径为绝对路径。
- 路径存在且为目录。
- 当前进程具有读取、创建和写入文件权限。
- `.obsidian/` 存在时显示为已识别 Vault；不存在时允许使用，但提示该目录尚未被 Obsidian 初始化。

C01 边界：

- `~/.lumer/config.json` 保存机器级启动配置和用户主动填写的 schema 2 Provider 配置；文件必须保持 `0600`。
- API Key、HTTP Provider base URL/model 和服务名称只允许位于 `openai_compatible` 对象、服务端内存和上游 Authorization 请求头；不得写入 Vault、Session、AnalysisRun 或其他业务记录，且 API/日志/UI 只返回脱敏状态。旧 `LUMER_OPENAI_COMPAT_*` 环境变量仅作为兼容回退。
- 切换 Vault 只切换业务数据根目录，不自动迁移或合并旧 Vault；切回旧 Vault 时重新读取其原有业务数据。
- bootstrap 在访问业务数据前必须取得当前 Vault 的跨进程排他 `runtime.lock`；锁由 OS 在进程退出/崩溃后释放，不使用无法可靠判断陈旧状态的裸 PID 文件。
- 每个业务 mutation 捕获不可变 `VaultContext` 并持有 mutation lease 到持久化完成；Settings 切换 Vault 必须取得 exclusive lease，有在途 mutation 时返回 `VAULT_BUSY`。
- 切换顺序固定为：校验新 Vault → 取得新 Vault runtime lock → 原子保存 config → 发布新 `VaultContext` → 释放旧锁。任一步失败保持旧 config/context/lock。
- 不能取得 runtime lock 时返回 `VAULT_ALREADY_OPEN`，不得以只读降级或第二进程继续写入。

## 2. Vault 布局

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

## 3. 文件所有权

| 文件 | 所有权与写入规则 |
|---|---|
| `Papers/*.pdf` | Lumer 托管；允许写标准 Annotation，不修改正文内容 |
| `.lumer/papers/*.json` | Lumer 唯一维护，Paper Source of Truth |
| `.lumer/extractions/*.json` | Lumer 可重建缓存，正文与页级 locator 基线 |
| `.lumer/analyses/**/*.json` | Lumer 维护；保存所有 Draft、失败信息和历史 Final |
| `.lumer/operations/imports/*.json` | Lumer 维护的短生命周期导入 journal；只用于崩溃恢复，不是 Paper Source of Truth |
| `.lumer/operations/annotations/*.json` | Lumer 维护的短生命周期 Annotation journal；只用于崩溃恢复，不是 Paper Source of Truth |
| `.lumer/runtime.lock` | 当前进程持有的 Vault 排他运行锁；不承载业务状态 |
| `.lumer/sessions/*.json` | Lumer 维护的 PDF Chat Session |
| `Paper Cards/*.md` | Lumer 生成、用户可编辑；覆盖前必须执行 hash 冲突检查 |

### 3.1 Chat Session 文件

每个 `.lumer/sessions/<paper_id>.json` 都是单篇 Paper 的双 Provider Chat 历史，必须保持 storage schema 1：

```text
ChatSessionStore:
  schema_version: 1
  paper_id: Uuid
  session_revision: integer >= 1
  sessions:
    codex: ChatSession | null
    openai_compatible: ChatSession | null
```

- Chat 文件不是 Paper Card、AnalysisRun 或 Evidence 的 Source；它只能在 PaperRecord 的 `current_final_run_id` 指向同 Paper `finalized` Run 后被读取或写入。
- 旧的 `sessions={codex: ...}` schema 1 文件在读取时补齐 `openai_compatible: null`；写回完整双槽位，不改变或丢失既有 Codex 消息。
- Codex 的 Session ID 可 resume；HTTP 只保存最近 task ID 与本 Provider 的消息历史，task ID 不得作为后续请求的 Session ID。
- 不保存正文上下文、Prompt、base URL、模型密钥、请求头、思考过程、原始错误正文或其他 Provider 的历史。

## 4. C02 托管文件命名合同

- 托管 PDF 固定使用 `<safe-original-stem>--<paper-id-short>.pdf`。
- canonical Paper Card 固定使用 `<safe-title>--<paper-id-short>.md`。
- `source_sha256` 相同即打开已有 Paper，即使再次导入时文件名不同；文件名相同但 SHA-256 不同则创建不同 Paper。
- `original_file_name` 仅作为 Metadata 保存，不参与 Paper 身份判断。
- `safe-*` 统一替换文件系统非法字符为 `-`、合并连续空白、清理首尾点号/空格；结果为空时使用 `untitled`。
- `paper-id-short` 先使用 UUID 的稳定短形式；若目标已被其他 `paper_id` 占用，则扩展到完整 UUID，禁止覆盖。
- `pdf_path` 创建后不可变。`card_path` 不因标题或 Metadata 编辑自动改名；只有用户在 Markdown 冲突中明确选择“另存新文件”时才允许切换 canonical path。
- “另存新文件”默认生成 `<card-stem>--copy-<YYYYMMDD-HHmmss>.md`；若同一目标已存在则追加递增序号，不增加第二个命名弹窗。
- 成功另存后新文件成为 canonical `card_path`；原文件保留并转为用户管理文件，Lumer 不再覆盖或删除它。
- `ImportCoordinator` 按计算完成的 `source_sha256` 取得进程内 key lock，并在锁内重新扫描 PaperRecord 后才能返回 duplicate 或创建 journal；同一 hash 的两个并发请求最多提交一个 Paper。

`safe-*` 算法冻结为：

1. 输入使用原始 stem 或用户确认标题，不包含扩展名。
2. 把 U+0000–U+001F 以及 `/ \\ : * ? " < > |` 的连续序列替换为单个 `-`。
3. 把连续 Unicode 空白折叠为一个 ASCII 空格。
4. 清理首尾空格和点号；结果为空或大小写不敏感地命中 `CON/PRN/AUX/NUL/COM1–COM9/LPT1–LPT9` 时使用 `untitled`。
5. `paper-id-short` 固定为 UUID 去除连字符后的前 8 个小写十六进制字符；目标路径已被不同 `paper_id` 占用时改用完整 UUID。
6. 最终扩展名由 Lumer 固定为小写 `.pdf` 或 `.md`；在实际写入前按目标文件系统规则再次检查冲突，绝不覆盖其他 Paper。

导入提交边界：

- 新 `paper_id` 与全部目标/临时相对路径确定后，必须先由 `ImportOperationRepository` 原子创建 `phase=preparing` 的 `.lumer/operations/imports/<paper_id>.json`；journal 成功前不得在 Vault 创建任何本次操作的临时或 canonical 文件。
- `ImportPaperService` 随后编排 `ManagedPdfStore` 与 `ExtractionRepository`，把 PDF 与 Extraction 写到 journal 已记录的同目录临时文件；两者完成 fsync/close 后把 journal 原子推进为 `staged`。
- 只有 `staged` journal 才允许依次原子 rename canonical PDF、Extraction；两者完成后把 journal 推进为 `files_committed`，最后由 `PaperRepository` 原子创建 PaperRecord。
- PaperRecord rename 是导入 commit point；Library/Reader 只枚举已有且合法的 PaperRecord，因此 commit point 前的文件不可见。
- commit point 前失败必须按 journal 的精确 Vault-relative path 尽力删除该操作的临时文件、canonical PDF 和 Extraction，并返回失败，不得创建 PaperRecord。
- 应用启动发现 import journal：`preparing` 且 PaperRecord/canonical 目标均不存在时只按 journal 精确路径清理临时文件与 journal，若出现 canonical 目标则保留 journal 并报告数据完整性错误；`staged/files_committed` 且 PaperRecord 不存在时按 journal 精确路径清理临时文件、canonical PDF 与 Extraction 后删除 journal；PaperRecord 存在且目标文件合法时删除 journal；PaperRecord 存在但目标缺失时保留 journal 并报告数据完整性错误，不猜测恢复内容。
- 无 journal 的未知孤儿文件不自动删除。commit point 后只剩 journal 清理失败时不回滚已导入 Paper；重启后按 PaperRecord 恢复并清理 journal。

`ImportOperation` 字段：

```text
schema_version: 1
operation_id: Uuid
paper_id: Uuid
pdf_path: VaultRelativePath
extraction_path: VaultRelativePath
temp_pdf_path: VaultRelativePath
temp_extraction_path: VaultRelativePath
phase: preparing | staged | files_committed
created_at: UtcDateTime
updated_at: UtcDateTime
```

- journal 不保存源绝对路径、PDF 内容、凭据或模型信息；临时路径必须是对应目标同目录、由 `operation_id` 确定的 Lumer 专用文件名。
- `extraction_path` 必须精确等于 `.lumer/extractions/<paper_id>.json`；`pdf_path` 必须符合本节 canonical 命名。

Annotation 提交与恢复：

- 所有 PaperRecord read-modify-write 由 `PaperOperationCoordinator` 的 per-Paper PaperRecord-write mutex 串行化。Annotation 必须按 `Paper lifecycle lease → PaperRecord-write mutex → PDF write lock` 取得资源，并从锁内最终重读 PaperRecord 持有到 PaperRecord commit 完成；Metadata、Finalization、Markdown sync、Recovery 与 Delete 不得在该窗口并发改写同一 Record。
- `AnnotationService` 在锁内确认 `expected_record_revision/pdf_revision/managed_pdf_sha256` 与磁盘 PDF SHA-256 全部一致，随后先原子创建 `phase=preparing` 的 journal；journal 成功前不得创建本次临时 PDF。
- 服务在 journal 指定的同目录临时副本上执行 PyMuPDF 变更。临时副本重新提取后的 `content_hash` 必须仍等于 ExtractedPaper；随后计算 `new_managed_pdf_sha256`，把 journal 原子推进为 `ready_to_commit`，再 atomic rename 替换 canonical PDF，最后原子更新 PaperRecord 的 `managed_pdf_sha256`、`pdf_revision+1` 与 `record_revision+1`。
- PaperRecord 更新是 Annotation operation 的 commit point。应用启动在开放业务 API 前、使用同一 mutex/lock 恢复 journal：`preparing` 只允许 canonical PDF/Record 仍为预期旧值，此时清理临时/journal；`ready_to_commit` 下，磁盘为旧 hash 且 Record 为预期旧值表示 PDF 尚未替换，清理临时/journal；磁盘为新 hash 且 Record 为预期旧 revision/hash 时补写 PaperRecord；Record 已为精确的 `record_revision+1/pdf_revision+1/new hash` 时只清 journal；其他组合保留 journal 并返回 `DATA_INTEGRITY_ERROR`。
- canonical PDF rename 后若首次 PaperRecord 写入失败，服务必须在释放 mutex/lock 或响应前按上述规则即时恢复：补写成功即返回正常 `AnnotationMutationResult`；无法判定/补写时返回非重试的 `DATA_INTEGRITY_ERROR`，不得返回可盲重试的 `ANNOTATION_WRITE_FAILED`。后者只用于 canonical rename 前的失败。

`AnnotationOperation` 字段：

```text
schema_version: 1
operation_id: Uuid
paper_id: Uuid
pdf_path: VaultRelativePath
temp_pdf_path: VaultRelativePath
expected_record_revision: integer >= 1
expected_pdf_revision: integer >= 1
expected_managed_pdf_sha256: Sha256
new_managed_pdf_sha256: Sha256 | null
phase: preparing | ready_to_commit
created_at: UtcDateTime
updated_at: UtcDateTime
```

- 同一 `paper_id` 最多一个 Annotation journal；创建、更新、删除 Highlight/Memo 走同一提交合同。
- `phase=preparing` 时 `new_managed_pdf_sha256=null`；`phase=ready_to_commit` 时必须非空，且必须等于 journal 对应临时 PDF 的 SHA-256。
- journal 只保存 hash、revision、ID 与相对路径，不保存 Annotation 文本、Memo、PDF 内容或绝对路径；`temp_pdf_path` 必须是 canonical PDF 同目录、由 `operation_id` 确定的 Lumer 专用文件名。

---

## 5. PaperRecord

最小字段：

```text
schema_version
paper_id
source_sha256
managed_pdf_sha256
pdf_revision
pdf_path
original_file_name
title
authors[]
year
journal
doi
tags[]
status: inbox | reading | read
current_final_run_id
card_path
markdown_hash
markdown_sync_status: not_generated | pending | synced | error | conflict
pending_card_path
markdown_sync_context
markdown_sync_error
record_revision
created_at
updated_at
```

字段合同：

| 字段 | 类型 | 空值/约束 |
|---|---|---|
| `schema_version` | literal `1` | 必填 |
| `paper_id` | `Uuid` | 不可变 |
| `source_sha256` | `Sha256` | 不可变，只表示导入原始字节 |
| `managed_pdf_sha256` | `Sha256` | 当前 canonical 托管 PDF 的完整字节 hash；导入时等于 `source_sha256` |
| `pdf_revision` | integer `>= 1` | 导入为 `1`；每次成功 Annotation 原子替换后递增 |
| `pdf_path` | `VaultRelativePath` | 不可变，且必须位于 `Papers/` |
| `original_file_name` | non-empty string | 仅 Metadata，不参与身份判断 |
| `title` | non-empty string | 用户确认值 |
| `authors` | `string[]` | 无作者时 `[]` |
| `year` | integer `\| null` | 未知时 `null` |
| `journal` | string `\| null` | 未知时 `null` |
| `doi` | string `\| null` | 未知时 `null` |
| `tags` | `string[]` | 每项 trim 后非空且不重复 |
| `status` | `inbox \| reading \| read` | 必填 |
| `current_final_run_id` | `Uuid \| null` | 受 C04/C07 指针 invariant 约束 |
| `card_path` | `VaultRelativePath \| null` | 非空时必须位于 `Paper Cards/` |
| `markdown_hash` | `Sha256 \| null` | 仅对应最后一次成功写盘的 `card_path` |
| `markdown_sync_status` | `not_generated \| pending \| synced \| error \| conflict` | 必填 |
| `pending_card_path` | `VaultRelativePath \| null` | 仅 `pending/error/conflict` 可非空 |
| `markdown_sync_context` | `MarkdownSyncContext \| null` | 当前一次 Markdown 写入/恢复的持久化上下文 |
| `markdown_sync_error` | string `\| null` | 仅 `error/conflict` 可非空；不得包含凭据 |
| `record_revision` | integer `>= 1` | 每次成功原子更新递增 |
| `created_at` | `UtcDateTime` | 不可变 |
| `updated_at` | `UtcDateTime` | 不早于 `created_at` |

`MarkdownSyncContext`：

```text
operation_id: Uuid
analysis_run_id: Uuid
renderer_version: non-empty version string
markdown_action: create | overwrite | save_as
target_card_path: VaultRelativePath
expected_markdown_hash: Sha256 | null
rendered_hash: Sha256
created_at: UtcDateTime
```

- `analysis_run_id` 必须等于当前 `current_final_run_id`；`renderer_version` 冻结生成 `rendered_hash` 的确定性模板版本；`target_card_path` 必须等于 `pending_card_path` 且位于 `Paper Cards/`。
- `overwrite` 的 `expected_markdown_hash` 必须非空；`create/save_as` 必须为 `null`。`rendered_hash` 是该不可变 Final 经确定性 Renderer 生成的目标字节 hash。

规则：

- `paper_id` 使用 UUID，与文件名、标题和 SHA-256 解耦。
- `source_sha256` 只表示导入文件的原始字节。
- `managed_pdf_sha256` 与 `pdf_revision` 共同表示当前受管 PDF 字节版本；任何外部字节修改，即使正文相同，也返回 `PDF_REPLACED`，不得被当作 Lumer Annotation 更新吸收。
- `analyzed: boolean` 不进入正式合同；是否已分析由 `current_final_run_id` 推导。
- 稳态下 `current_final_run_id` 只允许为空或指向同一 Paper 的 `finalized` Run；越过 C07 commit point 后可短暂指向冻结的 `finalizing` Run，恢复流程必须立即补为 `finalized`。
- `record_revision` 每次原子更新递增，用于拒绝基于旧 PaperRecord 的 Final commit。
- `card_path`、`markdown_hash` 只在 Markdown 成功写盘后更新；同步失败时保存状态和错误，不回滚 JSON Final。
- Metadata 人工编辑后不会被 Analyze 静默覆盖；Analyze 只给出候选值，由用户确认。
- `markdown_sync_status=synced` 时 `card_path`、`markdown_hash` 必须非空，`pending_card_path`、`markdown_sync_context` 与 `markdown_sync_error` 必须为 `null`。
- `markdown_sync_status=not_generated` 时 `markdown_hash`、`pending_card_path`、`markdown_sync_context`、`markdown_sync_error` 必须为 `null`；`card_path` 允许为 `null`。
- `markdown_sync_status=pending` 时 `pending_card_path` 与 `markdown_sync_context` 必须非空；`markdown_sync_error` 必须为 `null`。
- `markdown_sync_status=error/conflict` 时 `pending_card_path`、`markdown_sync_context` 与 `markdown_sync_error` 必须非空，供明确重试或恢复；新一次 sync 选择必须以最新 Record revision 原子替换整个 context。

## 6. ExtractedPaper

```text
schema_version
extraction_version
paper_id
source_sha256
content_hash
page_count
extracted_char_count
pages[]:
  pdf_page_index
  display_page_number
  text
created_at
```

字段合同：

| 字段 | 类型 | 空值/约束 |
|---|---|---|
| `schema_version` | literal `1` | 必填 |
| `extraction_version` | non-empty version string | 提取算法/依赖合同版本 |
| `paper_id` | `Uuid` | 必须对应 PaperRecord |
| `source_sha256` | `Sha256` | 必须等于 PaperRecord 的持久化导入身份 |
| `content_hash` | `Sha256` | 对规范化页序列与正文计算，不含 Annotation |
| `page_count` | integer `>= 1` | 必须等于 `pages.length` |
| `extracted_char_count` | integer `>= 0` | 必须等于所有 `pages[].text.length` 之和 |
| `pages` | `ExtractedPage[]` | 按物理页严格升序且不可缺页 |
| `created_at` | `UtcDateTime` | 本次提取生成时间 |

`ExtractedPage`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `pdf_page_index` | integer `>= 0` | 从 `0` 连续递增 |
| `display_page_number` | integer `>= 1` | 恒等于 `pdf_page_index + 1` |
| `text` | string | 允许空字符串，但整个文档空文本按 unsupported error 拒绝导入 |

规则：

- 使用 PyMuPDF 提取每个物理页正文。
- 页面顺序以 PDF 物理页为准。
- Annotation 文本、Memo 和 Highlight 元数据不得进入 `pages[].text`。
- 空文本、加密、扫描件和超限文件返回结构化 unsupported error。
- `content_hash` 使用 SHA-256，输入为 UTF-8 字节序列：固定前缀 `LUMER-EXTRACTED-TEXT-v1\n`，随后对每页按顺序追加 `<pdf_page_index>\n<text_utf8_byte_length>\n<text_utf8_bytes>\n`。长度前缀按十进制 ASCII 写入；同一正文重复提取必须得到同一值。
- 2C Spike 已冻结支持上限：`max_file_bytes=52,428,800`、`max_pages=500`、`max_extracted_chars=600,000`、`max_estimated_tokens=250,000`；可执行 Source of Truth 为 `app/src/lib/pdf/pdf-limits.v1.json`。
- estimated tokens 固定按每页 `ceil(UTF-8 byte length / 3)` 后求和，只用于确定性支持边界，不宣称等同 Provider tokenizer；任一上限超出均返回 `PDF_LIMIT_EXCEEDED`，details 只含 `limit_kind/limit/actual`。

## 7. C07 Final commit 与 Markdown 派生输出

2026-09-06 用户批准概览 Final：`unstructured-text-v1` 的完整 `raw_model_output` 在用户点击“同步到 Obsidian”后冻结，复用本节原子提交、Current Final、历史版本、`Paper Cards/` 路径及冲突/重试机制。结构化结果使用 `paper-card-v2`；概览使用 `paper-overview-v1`，Markdown 正文完整保留模型原文，front matter 标记 `result_kind: overview`、`confirmation: user`、`evidence_verified: false` 和 Run/Paper/provider/model/created_at。不截断、不二次调用模型、不把人工确认写成证据验证通过。下文 commit point 前“退回 draft”对概览应为“退回 preview”；概览 `draft_revision` 为 0。

JSON Final 是正式结果；Markdown 是 Final 提交后的派生输出，不为两者建设跨文件强事务。

提交顺序：

```text
验证 Draft revision / PaperRecord revision / content_hash / Evidence Gate
↓
检查 Markdown 外部修改并取得取消 / 覆盖 / 另存选择
↓
Run → finalizing，原子冻结 snapshot 与 finalization_context
↓
原子更新 PaperRecord.current_final_run_id
同时写入 markdown_sync_status=pending / pending_card_path / markdown_sync_context
                                                              ← Final commit point
↓
Run → finalized
↓
原子写入 Markdown
↓
成功后更新 card_path / markdown_hash / markdown_sync_status
```

原子持久化要求：

- `current_final_run_id` 所在 PaperRecord 必须在同目录创建临时文件，完整写入后执行 flush/fsync、close、atomic rename；平台支持时再 fsync 父目录。
- 禁止直接覆写 PaperRecord JSON；rename 成功才算越过 commit point。
- Run 状态、PaperRecord 和 Markdown 分别原子写入，但不宣称三个文件构成单一事务。

失败与恢复：

- 任何 preflight 失败或用户在 Markdown 冲突中选择“取消”：保持 `draft`，Current Final 与 Markdown 均不变。
- Run 已进入 `finalizing` 但 PaperRecord rename 失败：Current Final 保持旧值，Run 原子退回 `draft` 并记录 commit error。
- `current_final_run_id` 已更新后，新的 Final 正式成立；此后 Run 状态或 Markdown 写入失败都不得回滚 Current Final。
- commit point 后若 `Run → finalized` 写入失败，API 仍把 Final 报告为已提交；Run 可短暂保持 `finalizing`，启动/即时 Recovery 根据 Current Final 指针补为 `finalized`。
- commit point 必须在同一次 PaperRecord 原子 rename 中写入新 `current_final_run_id`、`markdown_sync_status=pending`、`pending_card_path` 与完整 `markdown_sync_context`，避免崩溃后新 Final 仍显示旧 Markdown 已同步。
- 后续显式 `sync-markdown` 在任何 Markdown I/O 前，必须先以最新 PaperRecord revision 原子写入本次 `pending_card_path/markdown_sync_context/pending`；不得只把请求 DTO 留在内存中。
- Markdown 成功后设为 `synced`，更新 `card_path`/`markdown_hash` 并清空 `pending_card_path`、`markdown_sync_context` 与旧错误。
- Markdown I/O 失败设为 `error`；外部 hash 在实际覆盖前再次变化则设为 `conflict`。两者都保留新 Final、旧 Markdown 和可重试入口。
- 应用重启发现 `finalizing`：若 Current Final 已指向该 Run，则补写为 `finalized`；未指向则退回 `draft` 并记录 commit error。
- Run 的 `finalization_context` 在 `finalized` 后继续保留，用于 Final commit 审计和 commit point 前恢复；每次 Markdown 写入/恢复只使用 PaperRecord 当前的 `markdown_sync_context`。Recovery 对 `pending/error/conflict` 使用 context 冻结的 `renderer_version`，先验证 Current Final、context 与确定性 Renderer 重建的 `rendered_hash` 一致，再检查 context 的 `target_card_path`；不支持该版本或重建 hash 不一致时保留 context 并返回 `DATA_INTEGRITY_ERROR`，不得改用当前模板猜测：
  - 磁盘 hash 已等于 `rendered_hash`：认定 Markdown rename 已成功但 PaperRecord 更新未完成，原子补写 `card_path/markdown_hash/synced`。
  - `create/save_as` 的目标不存在，或 `overwrite` 的磁盘 hash 仍等于 `expected_markdown_hash`：允许按同一 context 重试原子写入。
  - 磁盘 hash 同时不等于 `rendered_hash` 与 `expected_markdown_hash`：设为 `conflict`，不得覆盖。
- Markdown Writer 必须先写同目录临时文件并 fsync/close，在 rename 前执行合同要求的最后一次目标 hash 检查；rename 后 fsync 父目录。只有 PaperRecord 记录成功后才清理 `markdown_sync_context` 对应的 pending 状态。
- 成功“另存新文件”后才切换 canonical `card_path`；旧文件保持原样并退出 Lumer 管理范围。

## 8. 删除与生命周期边界

- V1 删除为一次明确确认后的永久删除，不建设废纸篓、软删除、撤销或恢复。
- Delete Cascade 的真正实现批次为 6F；阶段 2 的 Library 不提前拥有删除级联能力。
- Markdown 永不反向解析更新 JSON。
- 6F 删除时先按合同解析并固定受管对象清单；缺失的子文件视为已删除，其他 I/O 失败返回 `DELETE_FAILED`。
- Delete 必须取得该 Paper 的排他 lifecycle lease；存在 Chat、Analyze、Annotation、Finalization 或 Markdown sync 等在途 mutation 时返回 `PAPER_BUSY`。持锁后重验 `expected_record_revision`，并阻止任何新 mutation 进入直到删除结束。
- 排他 lease 内必须先通过 Recovery 处理该 Paper 的 Import/Annotation journal；journal 可安全完成/清理后才进入删除，任何 journal 仍处于不一致状态时返回 `DATA_INTEGRITY_ERROR`，不得把恢复证据一起删掉。
- 删除顺序固定为已恢复并清空 Operation journals → Session → AnalysisRuns → Extraction → 当前仍受管的 Paper Card → 托管 PDF → PaperRecord；PaperRecord 最后删除，是该 Paper 从 Library 消失的 commit point。
- commit point 前失败时保留 PaperRecord，并允许用户以同一 `paper_id` 和 revision 重试剩余删除；不得报告成功。
- PaperRecord 删除成功后即视为级联完成；已因“另存新文件”退出管理范围的旧 Markdown 从不进入删除清单。
