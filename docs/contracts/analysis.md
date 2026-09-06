# Analysis Contract

**覆盖合同**：C03、C04、C05、C06
**状态**：已确认；`openai_compatible` Preview 扩展代码已实现，5F 真实外部 Live Smoke/人工验收待用户配置

> 本文是 AnalysisRun、PaperAnalysis、Finding、Evidence、Evidence Gate 与 Final immutable 的 Source of Truth。Final commit 的原子写入细节见 `storage.md`。

本文复用 `storage.md` 定义的 `Uuid`、`Sha256`、`UtcDateTime`、严格 JSON、必填字段与显式 `null` 规则。4A 才实现可执行 Analysis Schema，1C 只冻结字段合同。

## 2026-09-06 已批准：概览 Final

- 用户点击“同步到 Obsidian”即确认当前完整概览为 Final；不额外要求转换结构化 Draft 或通过 Evidence Gate。
- 概览以 `analysis_schema_version=unstructured-text-v1` 区分，保留完整 `raw_model_output`、`paper_analysis=null`、`draft_revision=0`；不得构造 verified Evidence。旧 preview 无需迁移即可确认。
- 概览转换为 `preview → finalizing → finalized`；commit point 前失败或恢复回退到 `preview`，保留失败信息供重试，重新提交时清除失败信息。`FinalizationContext.expected_draft_revision` 允许概览的 0。
- 概览提交后不可变，复用 Current Final 与历史 Run；重新分析创建新 Run，旧 Final 保留。概览 Final 不支持派生结构化 Draft。
- 结构化 Final 的非空 PaperAnalysis 和 Evidence Gate 规则保持；下文涉及这些限制时仅适用于结构化分析。

## 1. AnalysisRun / C03 / C04

```text
schema_version
analysis_run_id
paper_id
state: running | preview | draft | finalizing | finalized | failed | cancelled | interrupted
retry_of_run_id
derived_from_run_id
draft_revision
provider
model
provider_session_id
prompt_version
analysis_schema_version
source_sha256
content_hash
raw_model_output
paper_analysis
evidence_gate
attempts[]:
  attempt_number
  started_at
  ended_at
  outcome
finalization_context:
  expected_draft_revision
  expected_paper_record_revision
  markdown_action
  target_card_path
  expected_markdown_hash
failure_stage
failure_message
created_at
updated_at
finalized_at
```

字段合同：

| 字段 | 类型 | 空值/约束 |
|---|---|---|
| `schema_version` | literal `1` | 必填 |
| `analysis_run_id` | `Uuid` | 不可变 |
| `paper_id` | `Uuid` | 必须对应同一 PaperRecord/ExtractedPaper |
| `state` | `running \| preview \| draft \| finalizing \| finalized \| failed \| cancelled \| interrupted` | 只允许本节状态转换；`preview` 是可确认保存的只读概览 |
| `retry_of_run_id` | `Uuid \| null` | 用户 Retry 时指向旧 Run |
| `derived_from_run_id` | `Uuid \| null` | “编辑 Final”时指向历史 Final |
| `draft_revision` | integer `>= 0` | `running` 初始为 `0`；首次 Draft 保存后为 `1` |
| `provider` | `codex \| openai_compatible` | `openai_compatible` 支持概览及用户确认的概览 Final；不支持结构化 Draft/Final |
| `model` | non-empty string | 无法可靠识别时固定写 `unknown` |
| `provider_session_id` | non-empty string `\| null` | Provider Session/task correlation ID 建立前或 `derived_from_run_id` 非空时允许 `null`；非派生的 `preview/draft/finalizing/finalized` 必须非空且本 Run 独占；HTTP task ID 不具备 resume 语义 |
| `prompt_version` | non-empty version string | 不可变 |
| `analysis_schema_version` | non-empty version string | 不可变 |
| `source_sha256` | `Sha256` | 创建 Run 时冻结 |
| `content_hash` | `Sha256` | 创建 Run 时冻结 |
| `raw_model_output` | string `\| null` | 收到完整响应后保存；不得包含凭据 |
| `paper_analysis` | `PaperAnalysis \| null` | 结构化 `draft/finalizing/finalized` 必须非空；概览含其 Final 始终为 `null` |
| `evidence_gate` | `EvidenceGate` | 独立于 Run state |
| `attempts` | `AnalysisAttempt[]` | 按 `attempt_number` 从 1 连续递增 |
| `finalization_context` | `FinalizationContext \| null` | `finalizing/finalized` 必须非空；commit point 前退回 Draft 时清空 |
| `failure_stage` | `AnalysisStage \| null` | `failed/interrupted` 必须非空；commit point 前退回 Draft 可保留 `finalizing` |
| `failure_message` | string `\| null` | `failed/interrupted` 及 commit point 前退回 Draft 必须非空；不得包含凭据、绝对 Vault 路径或原始 CLI 环境 |
| `created_at` | `UtcDateTime` | 不可变 |
| `updated_at` | `UtcDateTime` | 不早于 `created_at` |
| `finalized_at` | `UtcDateTime \| null` | 仅 `finalized` 非空 |

`AnalysisAttempt`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `attempt_number` | integer `>= 1` | 在同 Run 内连续递增 |
| `started_at` | `UtcDateTime` | 必填 |
| `ended_at` | `UtcDateTime \| null` | 进行中允许 `null` |
| `outcome` | `running \| succeeded \| schema_invalid \| provider_failed \| cancelled \| interrupted` | attempt 结束后不得仍为 `running` |

`FinalizationContext`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `expected_draft_revision` | integer `>= 0` | 概览为 0，结构化 Draft 至少为 1；必须等于提交前 revision |
| `expected_paper_record_revision` | integer `>= 1` | C07 preflight 乐观锁 |
| `markdown_action` | `create \| overwrite \| save_as` | 用户选择“取消”不得创建该对象 |
| `target_card_path` | `VaultRelativePath` | 必须位于 `Paper Cards/` |
| `expected_markdown_hash` | `Sha256 \| null` | `overwrite` 必须非空；`create/save_as` 为 `null` |

`AnalysisStage` 固定为：`validating_pdf \| extracting_text \| calling_provider \| validating_schema \| repairing_schema \| verifying_evidence \| draft_ready \| preview_ready \| finalizing \| save_conflict \| final_saved \| syncing_markdown \| markdown_sync_error \| interrupted \| failed`；`ARCHITECTURE.md` 的用户可见阶段必须复用同一枚举。

#### C03 状态机

```text
running → preview
running → draft
running → failed
running → cancelled
running → interrupted

draft → finalizing
preview → finalizing     # 用户点击“同步到 Obsidian”

finalizing → finalized
finalizing → draft        # 仅限 commit point 之前失败
finalizing → preview      # 概览在 commit point 之前失败
```

状态规则：

- 每次 Analyze 创建新 Run，不复用或覆盖旧 Run。
- 真实 Codex 或 OpenAI-compatible 概览完成后进入只读 `preview`；该 Run 保存完整 `raw_model_output`，不生成 `paper_analysis`，不进入 Evidence Gate 或 Draft；用户点击“同步到 Obsidian”后允许提交概览 Final。
- `draft_revision` 在每次 Draft 原子保存后递增；进入 `finalizing` 时把预期 revision 写入 `finalization_context`，revision 不一致立即拒绝提交。
- Draft 编辑只使受影响 Evidence 回到 `pending` 并重算 Gate，不运行 locator；显式 Verify 才执行 locator。编辑保存和 Verify 都会原子写回 Draft，并分别使 `draft_revision` 递增一次。
- `preview` 不原地重新分析，仅允许用户确认进入 `finalizing`；`finalized`、`failed`、`cancelled`、`interrupted` 为终态，不原地重新启动。
- Provider 内部 retry 保持同一个 Run，并追加 `attempts[]`；用户主动 Retry 创建新 Run、写入 `retry_of_run_id` 并强制沿用原 Run Provider，禁止借 Retry fallback。
- 应用启动时，残留 `running` 统一原子转换为 `interrupted`；残留 `finalizing` 按 C07 恢复。
- `cancel` 只结束当前 `running` Run 的最后一个 attempt 为 `cancelled`；不能把已经落盘的 `draft/finalizing/finalized` 回退。取消与 Provider 返回竞争时，由 Coordinator 串行化状态写入，先落盘的终态不可被迟到结果覆盖。
- Evidence Gate 保存为独立 `evidence_gate` 对象，不编码进 `state`。
- V1 全局最多存在一个 `running` 或 `finalizing` Run。用户可以阅读其他论文和继续 Chat，但所有第二个 Analyze/Save Final 入口禁用，并显示“已有论文正在分析”；API 同时返回结构化 `ANALYZE_ALREADY_ACTIVE`。
- 全局限制必须由服务端 Analyze Coordinator 强制执行，不能只依赖按钮禁用。
- Coordinator 在单个进程级互斥区内扫描所有 Run 并执行 check-and-create/check-and-finalize；不新增数据库或第二份活动索引。创建 `running` 或把 Draft 转为 `finalizing` 都必须持有同一互斥锁，并在锁内再次确认不存在其他活动 Run。
- 任一时刻 `paper_analysis`、`evidence_gate`、`attempts` 与错误字段必须作为同一个 Run JSON 原子保存，禁止跨文件拼接出一个 Run。
- 除 `failed/interrupted` 以及“commit point 前失败而退回的 Draft”外，`failure_stage` 与 `failure_message` 必须同时为 `null`。

#### C04 Final immutable

- `finalized` 表示该 Run 曾合法完成并成为不可变结果；其 PaperAnalysis、Finding、Evidence、Gate、Prompt、Provider、模型和版本字段不得再修改。
- `PaperRecord.current_final_run_id` 表示当前哪个不可变 Run 对产品生效；稳态目标为 `finalized`，C07 commit/recovery 窗口可短暂为 `finalizing`。旧 Final 失去当前指针后仍保持 `finalized`，不增加版本关系状态。
- “编辑 Final”必须复制为新的 `draft` Run，并记录 `derived_from_run_id`；编辑后重新执行 Evidence Gate，再保存为新的 Final。
- 派生 Draft 复制源 Final 的冻结 PaperAnalysis、Evidence、Gate、Provider/model/prompt/schema provenance 和 raw output，但 `provider_session_id=null`、`attempts=[]`，不虚构或复用 Provider Session；若未重新调用 Provider，后续派生 Final 也保持 `null`，完整调用证据仍由 `derived_from_run_id` 指向的源 Run 保存。
- 重新 Analyze 创建新的 `running` Run，不复用“编辑 Final”Draft。
- PaperRecord 的 Status、Tags 和用户确认后的 Metadata 独立可编辑，不修改历史 Final snapshot。
- Markdown 外部编辑永不反向修改 Final JSON。

## 2. PaperAnalysis / C05 Finding Gate

保留 PRD 的主要段落，并给可编辑项稳定 ID：

```text
metadata_candidate
background[]
research_questions[]
sample
methods[]
study_design[]
findings[]:
  finding_id
  claim
  evidence[]
user_notes
```

精确结构：

```text
PaperAnalysis:
  metadata_candidate: MetadataCandidate
  background: TextBlock[]
  research_questions: TextBlock[]
  sample: TextBlock | null
  methods: TextBlock[]
  study_design: TextBlock[]
  findings: Finding[]
  user_notes: TextBlock[]
  deep_reading: DeepReading

TextBlock:
  block_id: Uuid
  text: non-empty string

MetadataCandidate:
  title: string | null
  authors: string[]
  year: integer | null
  journal: string | null
  doi: string | null

Finding:
  finding_id: Uuid
  claim: non-empty string
  evidence: Evidence[]
```

- Analyze 只把 `MetadataCandidate` 写入所属 `AnalysisRun.paper_analysis`；它不得自动更新 `PaperRecord`，也不随 Final commit 写入。
- 只有用户通过 `POST /api/analysis-runs/[runId]/accept-metadata` 明确接受当前 Candidate，且 `draft_revision` 与 `PaperRecord.record_revision` 均匹配时，才能更新 Candidate 中非空的 Metadata 字段；未提供的字段保持现有 PaperRecord 值。

`deep_reading` 是 Codex 精读的结构化补充，范围严格止于核心结果；它保留在 Run JSON 中，但当前 Draft 编辑 DTO 和 Reader 页面不单独编辑或渲染。顶层 `author_interpretation` 与 `limitations` 已移除；读取历史 Run 时忽略这两个已废弃字段，后续写入不再保留。旧 Run 缺少 `deep_reading` 时按空结构迁移读取。

```text
DeepReading:
  bibliographic_metadata: { title, authors[], year, venue, volume, issue, pages, doi }
  author_profiles[]: { name, affiliation, research_areas[], source: paper_text | unavailable }
  core_question: { summary, technical_terms[]: { term, explanation, analogy } }
  hypotheses[]: { statement, rationale, theoretical_basis }
  research_design: { type, overview, rationale, strengths[], limitations[] }
  sample: { size, population, demographics, recruitment, inclusion_criteria[], exclusion_criteria[], implications }
  methods[]: { name, procedure, purpose, rationale, strengths[], limitations[], plain_language_explanation }
  analysis_pipeline[]: { step, purpose, rationale, output }
  analysis_methods[]: { method, metric, interpretation, why_used, formula_note }
  primary_results[]: { claim, quantitative_results, statistical_test, effect_size, confidence_interval, p_value, interpretation, evidence[] }
```

- `author_profiles` 只能转述论文正文明确给出的单位或研究方向；无法由正文确认时使用 `source: unavailable` 和空/`null` 值，禁止补写外部作者履历。
- `primary_results.evidence` 使用模型报告的原语言 `quote` 与物理 `page`，后续仍由既有 Finding/Evidence Gate 执行唯一定位和验证；`deep_reading` 不绕过 Gate。
- 不设 `secondary_results`、作者结论、理论/技术贡献或批判性不足等字段。

- `block_id`、`finding_id` 和 `evidence_id` 由 Lumer 在首次接受结构化输出时生成，模型不得负责 ID 身份。
- 用户对 Draft 的编辑保留既有 ID；新增项生成新 ID，删除项不得复用旧 ID。
- 所有数组保持用户可见顺序；Renderer 不得自行排序或合并段落。

Draft API 使用独立的可编辑 DTO，不接受持久化 Evidence 的定位/Gate 字段：

```text
EditablePaperAnalysis:
  metadata_candidate: MetadataCandidate
  background: EditableTextBlock[]
  research_questions: EditableTextBlock[]
  sample: EditableTextBlock | null
  methods: EditableTextBlock[]
  study_design: EditableTextBlock[]
  findings: EditableFinding[]
  user_notes: EditableTextBlock[]

EditableTextBlock:
  block_id: Uuid | null
  text: non-empty string

EditableFinding:
  finding_id: Uuid | null
  claim: non-empty string
  evidence: EditableEvidence[]

EditableEvidence:
  evidence_id: Uuid | null
  model_quote: non-empty string
  model_reported_page: integer >= 1 | null
```

- ID 为 `null` 表示新增，由服务端生成；非空 ID 必须已属于当前 Run 的同类对象，Evidence 还必须属于当前 Finding，禁止跨 Finding/Run 移用。
- 服务端以 DTO 重建用户可编辑字段；`source_quote`、页码校正、span、normalization、locator/verification status、`content_hash`、failure reason 和 Gate 永远由服务端拥有，客户端提交这些未知字段必须被严格拒绝。
- Finding `claim` 改变时，该 Finding 下全部 Evidence 清空定位字段并置回 `pending/unresolved`；单条 Evidence 的 quote、模型页码或所属 Finding 改变时同样失效。未改变时可以保留既有验证结果；新增 Evidence 初始为 `pending/unresolved`。

模型事实与用户笔记必须保持在不同字段，Renderer 不得混写。

#### C05 Finding Gate

- `findings[]` 中每一项都视为核心 Finding，不增加 `is_core` 分支。
- Final 至少包含一个 Finding；每个 Finding 至少包含一条 `verified` Evidence。
- Final 中保留的每条 Evidence 都必须是 `verified`；`pending`、`failed`、`ambiguous` 或 `not_found` 必须修正或从 Draft 删除。
- 每条 Evidence 的 `content_hash` 必须等于当前 ExtractedPaper；不一致时全部回到 `pending`。
- 编辑 Finding `claim`、Evidence quote 或页码后，相关 Evidence 立即失效并重新验证。
- Background、Methods、Metadata Candidate 和用户笔记不进入 V1 Finding Gate。
- Gate 不通过时不显示 `Save as Final`；V1 不提供人工强制绕过。
- Gate 只确认原文、位置和当前正文身份可复核，不宣称自动完成 Finding 与 Evidence 的语义蕴含判断。

## 3. Evidence / C06 Normalize

```text
evidence_id
finding_id
model_quote
source_quote
model_reported_page
pdf_page_index
display_page_number
source_span_start
source_span_end
normalization_steps[]
locator_status: unresolved | exact | normalized | ambiguous | not_found
verification_status: pending | verified | failed
content_hash
failure_reason
```

字段合同：

| 字段 | 类型 | 空值/约束 |
|---|---|---|
| `evidence_id` | `Uuid` | Lumer 生成且在 Run 内唯一 |
| `finding_id` | `Uuid` | 必须引用同一 PaperAnalysis 中的 Finding |
| `model_quote` | non-empty string | 永久保留模型/用户提交的待验证原文 |
| `source_quote` | string `\| null` | 仅成功唯一定位后非空 |
| `model_reported_page` | integer `>= 1 \| null` | 模型未提供时为 `null` |
| `pdf_page_index` | integer `>= 0 \| null` | 仅成功唯一定位后非空 |
| `display_page_number` | integer `>= 1 \| null` | 非空时恒等于 `pdf_page_index + 1` |
| `source_span_start` | integer `>= 0 \| null` | 页内 0-based UTF-16 字符 offset |
| `source_span_end` | integer `> source_span_start \| null` | exclusive end offset |
| `normalization_steps` | `NormalizationStep[]` | exact 时 `[]`；按实际执行顺序保存 |
| `locator_status` | `unresolved \| exact \| normalized \| ambiguous \| not_found` | 必填 |
| `verification_status` | `pending \| verified \| failed` | 必填 |
| `content_hash` | `Sha256 \| null` | `verified` 必须为当前 ExtractedPaper hash |
| `failure_reason` | `EvidenceFailureReason \| null` | `failed` 必须非空 |

`NormalizationStep` 只允许：`nfkc \| remove_soft_hyphen \| collapse_whitespace \| join_linebreak_hyphenation \| normalize_quotes \| normalize_dashes`。

`EvidenceFailureReason` 只允许：`content_hash_mismatch \| page_out_of_range \| ambiguous_match \| quote_not_found \| cross_page_quote \| invalid_span`。

`EvidenceGate`：

```text
status: pending | passed | failed
content_hash: Sha256
checked_at: UtcDateTime | null
finding_results[]:
  finding_id: Uuid
  status: passed | failed
  reasons: EvidenceGateReason[]
```

`EvidenceGateReason` 只允许：`missing_finding \| no_verified_evidence \| unverified_evidence \| content_hash_mismatch`。

- `pending` 时 `checked_at=null`；`passed/failed` 时 `checked_at` 非空。
- `passed` 要求 `finding_results` 非空且全部 `passed`；任一失败项存在时 Gate 必须为 `failed`。
- `locator_status=exact|normalized` 且全部定位字段完整、`content_hash` 一致时才允许 `verification_status=verified`。
- `locator_status=ambiguous|not_found` 必须对应 `verification_status=failed` 与匹配的 `failure_reason`。

#### C06 Evidence normalize

匹配顺序：

1. 在模型报告页执行 exact substring match。
2. 未命中时在模型报告页执行 normalized match。
3. 仍未命中时按相同顺序搜索全文。
4. 全文只有一个位置命中时允许校正模型页码，并在 Preview 标记“页码已校正”。
5. 多页或多位置命中为 `ambiguous`；零命中为 `not_found`。

仅允许以下用于匹配的确定性标准化：

- Unicode NFKC。
- 移除 soft hyphen。
- 合并换行与连续空白。
- 连接由 PDF 换行造成的断词连字符。
- 统一常见弯/直引号和破折号形式。

执行顺序冻结为：NFKC → 移除 soft hyphen → 连接 PDF 换行断词连字符 → 统一引号 → 统一破折号 → 合并换行与连续空白。只有实际改变文本的步骤才写入 `normalization_steps[]`。

- “连接换行断词连字符”只删除两个 Unicode letter 之间的 `-`、其后的可选水平空白、一个换行及换行后的可选水平空白；普通行内连字符不得删除。
- exact 在原始 `pages[].text` 上执行；normalized 同时规范化 quote 和候选页文本，并维护规范化字符到原始 UTF-16 offset 的映射，最终 span 必须回指原始页文本。
- 模型页码存在且有效时，先只在该页查找；该页多位置命中立即为 `ambiguous`。该页零命中才进入全文逐页搜索。
- 模型页码为空或越界时直接进入全文逐页搜索；越界事实写入失败/校正审计，但不得访问不存在页面。
- 全文搜索必须统计所有物理页的全部位置；恰好一个命中才允许校正页码，两个及以上位置一律为 `ambiguous`。

明确禁止模糊匹配、编辑距离、任意删除实词或标点、Embedding、LLM/语义相似度和把释义当作原文。V1 一条 Evidence 必须完整定位在一个物理页；跨页引文必须拆分后重新验证。

审计要求：

- `model_quote` 永久保留模型原始输入；`source_quote` 保存匹配位置对应的真实提取原文。
- 保存物理页、0-based 字符区间和实际执行的 `normalization_steps[]`。
- `source_quote`、span、页码和 `content_hash` 一起决定是否可复核；任一缺失都不能设为 `verified`。

## 4. 关键语义边界

- Evidence Gate 证明引文存在、页码可定位、正文身份一致；不自动证明 Finding 与 Evidence 的语义蕴含成立。
- Finalized Run 是不可变历史结果；当前生效版本只由 `PaperRecord.current_final_run_id` 指向关系决定。
- 用户编辑 Final 必须派生新 Draft；Markdown 外部编辑不修改历史 Final JSON。
