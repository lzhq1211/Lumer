# Provider & Session Contract

**覆盖合同**：C08
**状态**：已确认；5E–5F 的 HTTP Overview 已实施。2026-09-05 已批准第 7 阶段扩展：Final Paper Card 后的 Codex / OpenAI-compatible 自由 Chat。

> 本文是 Codex Provider、OpenAI-compatible HTTP Provider、Chat Session、Analyze Task、凭据边界和版本记录的 Source of Truth。Claude Code 仍只保留不可操作 UI 占位，不是本合同中的 Provider。

本文复用 `storage.md` 定义的 `Uuid`、`UtcDateTime`、严格 JSON 与显式 `null` 规则。现有 5A–5D 与 5E–5F 保留为实施历史；第 7 阶段在不改变结构化 Analyze / Evidence / Final 边界的前提下扩展 HTTP Chat。

## 1. C08 Provider / Session 配置与隔离

- `ChatProvider = codex | openai_compatible`；自由 Chat、解释选中文本与翻译可显式选择二者之一。
- `AnalyzeProvider = codex | openai_compatible`；`openai_compatible` 支持 `overview`，不支持结构化 `analyze` 或 `schema_repair`。2026-09-06 用户批准：两种 Provider 的概览均可经“同步到 Obsidian”确认成为概览 Final，此操作只持久化已有结果，不调用 Provider。
- Codex 直接使用 Codex CLI 已有的本机登录状态；Lumer 不保存其密钥、Token 或登录凭据。
- OpenAI-compatible HTTP Provider 优先从 `~/.lumer/config.json` 的 `openai_compatible` 对象读取配置；未配置该对象时兼容读取服务端环境变量：
  - `LUMER_OPENAI_COMPAT_BASE_URL`：包含 `/v1` 的绝对 base URL；实现去除末尾 `/` 后调用 `${base_url}/chat/completions` 和 `${base_url}/models`。
  - `LUMER_OPENAI_COMPAT_MODEL`：非空模型 ID。
- `LUMER_OPENAI_COMPAT_API_KEY`：可选；存在时只作为 `Authorization: Bearer ...` 请求头使用。无鉴权的 loopback 本地服务可以不设置。
- Settings 可将 `app`、`base_url`、`model` 和 `api_key` 保存到 schema 2 的 `openai_compatible` 对象；API Key 只保存在 `0600` 的本机配置文件和服务端内存中，不由任何 API/日志/UI 回显。
- Provider 配置保存成功后，运行时状态和后续请求立即读取最新 `config.json`；未建立 schema 2 Provider 对象时继续回退到旧环境变量，空 API Key 保存不会清除已有 Key，清除必须通过独立 Settings API 操作。
- 远程 HTTP Provider 只允许 `https:`；`http:` 只允许 `localhost`、`127.0.0.1` 或 `[::1]`。不得跟随会把凭据发送到不同 origin 的重定向。
- `~/.lumer/config.json` 保存 `default_chat_provider`、`default_analyze_provider` 以及可选的 schema 2 `openai_compatible` 配置对象；旧 schema 1 文件继续可读，首次保存自定义配置时迁移到 schema 2。
- V1 不在 Vault、HTTP API 响应或业务记录中保存/回显 API Key；Settings 可写入本机 `config.json` 的 Provider 配置，且不支持任意 headers、权限参数或高级生成参数。
- Analyze/概览必须使用请求中明确指定的 Provider；失败时不得切换到另一个 Provider。最后一次选择只有经 UI 显式调用 `PUT /api/settings` 才可更新本地默认值。
- 自由 Chat 只在该 Paper 的 `current_final_run_id` 指向同 Paper 的 `finalized` Run 后可用，包括用户确认的概览 Final；这是“已有 Final”的唯一程序判定。`preview`、`draft`、`running`、`finalizing`、失败或无 Run 均不得显示或调用 Chat；Markdown 同步状态不额外阻塞已成立的 Final。Chat 仍使用通过 source/content hash 校验的论文正文，不将概览确认为 Evidence verified。
- 自由 Chat 在 `.lumer/sessions/<paper_id>.json` 中按 Provider 分别保存历史。Codex 保存可续接 Session；HTTP 保存应用侧消息历史与最近 task ID，但不具有可续接 Session 语义。
- 每次 Chat 都必须校验并读取该 Paper 的 `ExtractedPaper`，其 `source_sha256` 必须等于 PaperRecord；正文仅作为带物理页码的非可信上下文传入，不是 Chat 的显示资格。
- 每次实际 Analyze/用户 Retry 创建新 AnalysisRun。Codex 创建全新 Provider Session；OpenAI-compatible Overview 创建独立 HTTP task correlation ID，不提供可续接会话语义。
- Analyze/概览保存 `provider_session_id`、provider、model、prompt/schema version、最终 raw output、attempts 和错误摘要；HTTP task correlation ID 仍写入既有 `provider_session_id` 字段以保持 schema 兼容，但不得把它用于 resume。
- Streaming 中间事件、请求头、base URL、API Key 与原始 Provider 错误正文不长期保存。
- Codex 未安装/未登录，或 HTTP Provider 未配置/鉴权失败/不可用时返回明确错误；均不得 fallback。
- Claude Code 按钮必须标注“未接入”并禁用；不得触发 CLI 探测、登录检查、Provider 调用、配置写入、Session 写入或 adapter fixture。
- 用户明确选择 `openai_compatible` 发起概览时，论文正文会发送到其自行配置的外部服务；UI 必须在 Provider 状态/选择处明确提示这一数据边界。

### 1.1 Provider 与可用性 DTO

```text
Provider = codex | openai_compatible
ChatProvider = codex | openai_compatible
AnalyzeProvider = codex | openai_compatible

ProviderStatus:
  provider: Provider
  transport: cli | http
  configured: boolean
  installed: boolean | null
  authenticated: boolean | null
  available: boolean
  detected_model: non-empty string | null
  failure_code:
    PROVIDER_NOT_CONFIGURED |
    PROVIDER_NOT_INSTALLED |
    PROVIDER_NOT_AUTHENTICATED |
    PROVIDER_UNAVAILABLE |
    null
```

- Codex：`transport=cli`；`installed/authenticated` 使用实际 CLI 检测；`configured=true` 表示当前 CLI 入口可被检查。
- OpenAI-compatible：`transport=http`、`installed=null`；base URL 或 model 缺失/非法时 `configured=false`；`authenticated` 由不携带论文正文的 `${base_url}/models` 检查判定，无法判断时为 `null`。
- HTTP 状态检查硬超时 10 秒，只允许读取模型列表/鉴权状态，不发送论文正文。仅当配置合法、检查成功且配置模型可用时 `available=true`。
- HTTP `401/403` 映射 `PROVIDER_NOT_AUTHENTICATED`；网络失败、超时、非预期响应、模型不可用和其他非 2xx 映射 `PROVIDER_UNAVAILABLE`。
- `detected_model` 无法可靠解析时必须为 `null`；写入 AnalysisRun 时优先使用 Provider 响应中的 model，缺失时使用本次明确请求的配置模型，不得根据产品默认值猜测。
- 状态 DTO 不得包含 CLI/API 输出全文、环境变量、base URL、Token、Cookie、用户目录或其他凭据线索。

### 1.2 Chat Session 持久化 DTO

`.lumer/sessions/<paper_id>.json` 保存按 Provider 隔离的 `ChatSessionStore`：

```text
ChatSessionStore:
  schema_version: 1
  paper_id: Uuid
  session_revision: integer >= 1
  sessions:
    codex: ChatSession | null
    openai_compatible: ChatSession | null

ChatSession:
  session_id: Uuid
  provider: ChatProvider
  provider_session_id: non-empty string
  model: non-empty string
  messages: ChatMessage[]
  created_at: UtcDateTime
  updated_at: UtcDateTime

ChatMessage:
  message_id: Uuid
  role: user | assistant
  content: non-empty string
  created_at: UtcDateTime
```

- `sessions.codex.provider` 必须为 `codex`；`sessions.openai_compatible.provider` 必须为 `openai_compatible`；两个槽位的消息、模型、Session/task ID 不得互读或覆盖。
- Codex 的 `provider_session_id` 是可续接 Session ID；HTTP 的同字段仅保存最近完成请求的 task correlation ID，任何 HTTP Chat 后续请求仍必须使用 `new/no-session`。
- 旧 schema 1 文件的 `sessions={codex: ...}` 在读取时补齐 `openai_compatible: null`，写回时使用完整双槽位；不得丢失旧 Codex 历史或提升全局 storage schema 版本。
- `model` 无法可靠识别时固定写 `unknown`，不得根据默认值猜测。
- Chat 消息按 `created_at` 和文件顺序追加；已持久化消息不可被 Streaming 中间片段重复追加。
- 只保存完成的 user/assistant 消息；thinking、工具调用明细、环境变量、系统 Prompt、凭据与原始 CLI stderr 不长期保存。
- Chat Session 文件只由 Session Repository 写入；Paper Repository、AnalysisRun Repository 和 Provider Adapter 不得直接修改。
- Session Repository 对同一 `paper_id` 的 read-modify-write 使用进程级互斥锁，锁内重新读取并原子写入完整文件；每次成功写入使 `session_revision` 递增。
- `ChatService` 对同一 Paper 的任一 Provider Chat task 与 Session commit 持有独占 lease；第二个任务返回 `CHAT_ALREADY_ACTIVE`。
- user/assistant 消息对只在 Provider 成功完成后一次原子提交；Session 写入成功前不得向客户端发出 `completed`。写入失败返回 `SESSION_WRITE_FAILED`，不得把未持久化响应报告为已完成。
- Chat Service 从受限 Registry 解析明确指定的可用 ChatProvider；Analysis Service 不得直接写配置或 Chat Session，也不得把 Analyze Session/task 复作 Chat。

### 1.3 Provider Adapter 边界

Provider Adapter 的领域输入输出保持统一：

```text
ProviderTaskRequest:
  provider: Provider
  task_kind: chat | overview | analyze | schema_repair
  session_mode: new | resume
  provider_session_id: string | null
  model: string | null
  system_prompt: string
  user_input: string

ProviderStreamEvent:
  type: session | text_delta | thinking_delta | completed | failed
  provider: Provider
  provider_session_id: string | null
  model: string | null
  text: string | null
  error_code: string | null

ProviderTaskResult:
  provider: Provider
  provider_session_id: non-empty string
  model: non-empty string
  final_text: string
```

任务支持矩阵：

| Provider | chat | overview | analyze | schema_repair | resume |
|---|---:|---:|---:|---:|---:|
| `codex` | 是 | 是 | 是 | 是 | Chat/repair 可用 |
| `openai_compatible` | 是 | 是 | 否 | 否 | 否 |

- Codex `chat` 可使用 `session_mode=resume`；HTTP `chat` 必须使用 `new/no-session`。`overview` 必须使用 `new`。Codex `analyze` 使用 `new`，Codex `schema_repair` 必须以 `resume` 续接同一 AnalysisRun Session。
- OpenAI-compatible Adapter 只接受 `task_kind=overview | chat`、`session_mode=new`、`provider_session_id=null`；其他组合必须在调用外部服务前以合同错误拒绝。
- OpenAI-compatible 请求使用原生 `fetch`，`stream=false`，仅发送 `model`、system/user messages 和 `stream`；5E–5F 不增加 SDK、任意 headers、temperature、max tokens、tool calling、response format 或其他高级参数。
- HTTP Adapter 只接受完整非空的 `choices[0].message.content`；model 优先使用响应字段，task correlation ID 优先使用响应 `id`，缺失时生成本地 UUID。不得把 HTTP task ID 当作可恢复 Session。
- Adapter 只负责 CLI/HTTP 协议、Session/task ID 和流转换，不解析 PaperAnalysis、不验证 Evidence、不写 Repository。
- `completed` 或 `failed` 是单次任务唯一终止事件；终止后到达的迟到事件必须丢弃并记录诊断，不得改变领域状态。
- `overview` 的 `final_text` 是完整纯文本概览，不要求 JSON Schema；Codex `analyze/repair` 的 `final_text` 才进入既有严格 JSON 解析；thinking 与工具输出不得拼入。
- Overview、Codex Analyze 与其一次 Schema Repair 均有 300 秒硬上限；超时必须终止 CLI/abort fetch、以 `PROVIDER_PROTOCOL_ERROR` 结束当前 Run，并且不得 fallback。Codex Chat 不受该硬上限约束；HTTP Chat 使用与 HTTP Overview 相同的请求中止与协议失败边界。
- `AbortSignal` 仅是 Route 到 Provider Adapter 的进程内控制面，不属于 `ProviderTaskRequest`、不得持久化。SSE 断开时，Route 必须先将已创建的 Run 落为 `interrupted`，再终止 CLI/HTTP 请求；迟到结果不得覆盖终态。

---

## 2. Analyze 与 Chat 的共同边界

- Lumer 复用同一 Provider port、Run 状态机、SSE、取消和审计链；新增 HTTP Adapter 不得复制第二套 AnalysisRun、Repository、Evidence、Final 或 Markdown Runtime。
- 自由 Chat 与 Analyze Overview 均可显式选择 Codex 或 `openai_compatible`。两者任务入口、Session/task ID、消息历史和输出合同保持隔离。
- HTTP Chat 的每一次调用由应用重新组装当前问题、必要的同 Provider 历史和本地确定性选择的 Extraction 段落；不得把 HTTP task ID 当作会话恢复，也不得混入另一 Provider 的历史。
- 正文段落选择在本地执行、带物理页码、受版本化上下文总预算限制；当前批准的 Chat 单次总预算为 `max_estimated_tokens=250,000`，覆盖 system prompt、当前问题、有限同 Provider 历史与正文片段。该值是应用硬上限，不等同于外部 Provider 的稳定接受证明；不得盲目发送整篇支持上限内 PDF，也不得建设向量数据库或远程检索服务。
- 概览收集完整模型响应后以纯文本显示；现有 Codex 结构化 Analyze 收集完整模型响应后再解析 JSON；两者均不渲染半截 Provider 输出。
- 任一 Provider 失败不得伪装为另一 Provider 成功；用户 Retry 必须创建新 Run 并继续使用原 Run 的 Provider。
- 5E–5F 不改变 Evidence Gate、Final、Markdown、PDF/Vault 数据所有权和全局单活动 Run 合同。

## 3. 5E–5F 明确非目标

- 不接入 Claude Code，不把其占位按钮复用为 HTTP Provider。
- 不为 `openai_compatible` 建立可续接 Session、结构化 Draft、Schema Repair、Evidence Gate 或 Final；HTTP Chat 只重放其自身持久化的有限历史。
- 不支持多个 HTTP 配置档案、按请求传 base URL/model/API Key、模型发现选择器或 Provider 插件市场。
- 不在 UI、HTTP API、`~/.lumer/config.json`、Vault、日志、错误 envelope 或 AnalysisRun 中保存/返回 API Key。
- 不做自动 fallback、自动切换模型、向量 RAG、远程检索、客户端上下文上传或供应商专属协议分支；第 7A 批准的本地确定性正文段落选择不属于这些能力。
