# Lumer V1 Test Plan

**版本**：v1.3（第 7 阶段 Final Paper Card 门控 Chat 追加）
**状态**：Architecture / Data Contracts 与 1D Design Gate 已确认；7A–7D Chat 测试责任已冻结，后续批次逐项实现

## 1. 测试资产与质量门

### 1.1 固定 PDF Fixture

- 正常单栏可提取 PDF。
- 正常双栏可提取 PDF。
- 已包含原生 Highlight/Memo 的 PDF。
- 纯扫描 PDF。
- 加密 PDF。
- 损坏 PDF。
- 恰好位于长论文阈值内/外的边界 PDF。

测试 fixture 使用项目可合法保留的合成文件或公开测试文件；真实用户论文仅用于人工验收，不提交到仓库。

### 1.2 测试分层

| 层级 | 覆盖范围 |
|---|---|
| Design Gate | 1D Final Tokens、四页真实低保真、全部状态、导航、组件、区域比例、最小窗口宽度与中文文案 |
| Contract | 严格 DTO、API envelope、错误码、Provider Adapter、SSE 终止事件、Repository port；不得访问真实外部系统 |
| Unit | Zod、safe filename、hash、路径、atomic write、Renderer、Evidence normalize/locator、C03 状态转换、Finding Gate |
| Integration | 临时 Vault、导入/去重、PyMuPDF、Repository、全局 Analyze Coordinator、Final commit/recovery、Markdown sync、删除 |
| Component | `docs/frontend/ui-states.md` 四页状态矩阵、Editor、Gate、全局 Analyze 禁用提示、Conflict Dialog、Markdown sync、中文文案与原语言 Evidence 展示 |
| E2E Mock | 完整主链，不依赖真实 Provider |
| Live Smoke | Codex、真实 PDF、真实 Obsidian；Claude Code 仅验证“未接入”占位状态 |

### 1.3 不允许伪通过

- Mock Provider 通过不等于真实 Analyze 通过。
- Zod 通过不等于 Evidence 通过。
- 引文存在不等于自动证明 Finding 语义正确。
- Claude Code 占位按钮不等于已接入 Provider；不得以按钮存在报告 Claude Code 测试或验收通过。
- 页面可打开不等于重启恢复通过。
- Markdown 已生成不等于外部冲突保护通过。
- Paper Card 为中文不等于 Evidence 可以翻译；Evidence 必须继续匹配原语言 PDF 正文。

### 1.4 责任边界

| 被测对象 | 主要测试层 | 责任 |
|---|---|---|
| Domain enum、状态转换、Gate、normalize、Renderer | Unit | 纯函数覆盖所有合法/非法分支，不 mock 自身规则 |
| Route DTO、错误 envelope、HTTP/SSE 映射 | Contract | 断言正式路径、严格字段、稳定错误码、单一终止事件与敏感信息不泄露 |
| Repository、atomic file、跨 Repository Service | Integration | 使用临时 Vault 和故障注入验证真实文件结果与恢复，不用内存对象替代持久化结论 |
| Codex Provider Adapter | Contract + Live Smoke | fixture 验证协议；Codex 真实链验证安装、登录、Session、model/version 记录；不探测、调用或 fixture 模拟 Claude Code |
| React 状态与交互门 | Component | 断言按钮、错误、禁用、Retry、Conflict、Gate 和中文文案，不以源码存在为通过 |
| 产品主链与生命周期 | E2E Mock + Live/Restart E2E | 验证用户可观察结果、重启和磁盘事实 |

完整的 C01–C08 → Schema/API/错误/测试/批次映射以 `docs/contracts/TRACEABILITY.md` 为准；测试文件不得重新定义领域合同。

### 1.5 批次 1D Design Gate

- `docs/frontend/lumer-design-tokens.v1.json` 必须通过同目录 JSON Schema，且 `meta.status=final`、`token_version=1.0.0`、页面集合精确为四页。
- `wireframes.html` 必须暴露四页状态 manifest；自动化逐状态打开并断言页面/状态 ID、评审摘要、合同说明、console errors=0、page errors=0。
- 必需 25 个页面状态与跨页 Run、Markdown、Delete、最小窗口状态必须全部有可视表现；当前 canonical manifest 共 33 个状态。
- 浏览器截图基线位于 `docs/frontend/screenshots/`，至少覆盖四页默认/通过态以及 Delete、窗口过窄、Unsupported PDF、Markdown 冲突/失败、Invalid Vault。
- 用户必须逐页评审真实低保真、状态矩阵、1280px 最小宽度和基础组件选择；人工验收前不得把 1D 标记为完成或进入 2A。

必须包含的并发/崩溃矩阵：

- Vault：mutation 期间切换返回 `VAULT_BUSY`；第二进程无法取得 runtime lock；新 Vault lock/config 发布任一步失败都继续使用旧 Vault。
- Import：两个相同 `source_sha256` 并发只提交一个 Paper；证明 journal 先于任何 Vault temp，并对 journal 创建、temp 创建、phase 推进、PDF rename、Extraction rename、PaperRecord rename 前后逐点故障注入并验证恢复。
- Annotation：创建/更新/删除串行化；证明 `preparing` journal 先于 temp，并对 phase 推进、PDF rename、PaperRecord hash/revision 更新前后故障注入；rename 后 Record 首写失败必须即时恢复为成功或非重试完整性错误；Annotation 与 Metadata/Finalization/Markdown sync 的所有交错由 PaperRecord-write mutex 串行化；外部替换为同正文不同字节 PDF 仍返回 `PDF_REPLACED`。
- Analyze/Finalize：并发 check-and-create 与 draft→finalizing 共用同一活动锁；任何调度顺序最多一个 `running/finalizing`。第二个入口/API 必须拒绝；取消只允许 `running`，SSE 消费端断开把未结束 Run 置为 `interrupted`，两者都必须验证 Provider 迟到结果不能覆盖终态；用户 Retry 必须新建并写入 `retry_of_run_id`，同 Run Provider retry 不得改变该关系。
- Chat：同 Paper 的跨 Provider 并发返回 `CHAT_ALREADY_ACTIVE`；Session 写失败不得发送 completed。无 Final Paper Card 的 GET/POST 返回 `PAPER_CARD_REQUIRED`、不读写 Session、也不调用 Provider；Preview/Draft 不得解锁，旧 Final 在重新 Analyze 期间继续解锁。
- Chat Context：每次请求校验 Extraction 的 `source_sha256`，按 `max_estimated_tokens=250,000` 的固定版本化总预算选择带页码段落；超限本地返回 `CHAT_CONTEXT_LIMIT_EXCEEDED`（413），不发送正文、不执行正文指令。Codex 首轮/续接与 HTTP 每次新 task 均须覆盖。
- HTTP Chat：只接受 `chat/new/no-session`，复用服务端环境 profile；HTTP task ID 不得 resume；Codex/HTTP 消息历史隔离，失败不 fallback，删除级联清理两槽位 Session。
- Reader Chat UI：只断言/修改自由对话区域；对“标注与 Memo”和“生成论文概览 / 生成可信论文卡片”两卡保留回归断言（文案、按钮可访问名称、可用/禁用状态、关键计算样式与相邻间距），防止 Composer CSS 或条件渲染改变参考图中的既有区域。
- Delete：有 Chat/Analyze/Annotation/Final/Sync 在途时返回 `PAPER_BUSY`；排他 lease 内不得产生新 Session/Run/Annotation；Import/Annotation journal 必须先恢复/清空，不一致 journal 阻止删除，重试删除不遗留孤儿。
- Analyze liveness：Codex 概览/Analyze/Schema Repair 超过 300 秒必须终止子进程、仅结束当前 Run 且不触发第二次 Provider retry；Reader 卸载造成 SSE 断开时必须先写入 `interrupted`，abort 的 Provider 与迟到成功均不得恢复 Preview/Draft。
- Markdown：覆盖 commit point 前后、Run finalized 写入失败，以及首次 Final sync/后续 `sync-markdown` 各自在 context 写入、Markdown rename、PaperRecord 更新前后的崩溃窗口；Recovery 必须使用当前持久化 `MarkdownSyncContext.renderer_version` 和确定性 rendered hash 区分自身已写结果与外部冲突，版本不支持/重建不一致必须 fail closed。

### 1.6 批次 1C 文档质量门

1C 不实现可执行 Schema、Repository 或 API，但必须通过以下静态审计：

- C01–C08 每项都有唯一规则 Source of Truth、Schema/字段、写入 owner、正式 API、错误码、自动测试责任与实施批次。
- 所有持久化字段组都有规则 owner 和唯一底层写入 owner；不存在 Route/UI/Provider 直接写文件的旁路。
- 所有正式错误都使用 `docs/contracts/api.md` 的 envelope 和目录；UI 不解析 message 决策。
- Architecture、Storage、Analysis、Provider、API、Traceability 与 Test Plan 的交叉引用存在，且没有遗留未决项或占位标记。
- 执行 `git diff --check`，并重跑当前已有 typecheck、lint、unit、integration、build、E2E 基线，证明文档批次没有破坏独立应用。

---

## 2. V1 端到端冻结要求

- Mock E2E 必须完整跑通，不依赖真实 Provider。
- Codex 必须完成 Live Smoke；Claude Code 仅保留“未接入”且不可操作的 UI 占位，不进入 Live Smoke。
- Restart / Conflict / Delete 生命周期必须在 V1 Freeze 前通过。
- 不存在会损坏 PDF、JSON、Final 或用户 Markdown 的已知 P0 缺陷。
