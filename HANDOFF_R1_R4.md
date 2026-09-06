# Lumer Assistant R1-R4 代码简化 Handoff

## 0. 文档定位

本文用于把 2026-09-04 的只读代码审查交接给下一位执行者，范围仅包括 R1-R4。

- 本文是实施交接说明，不替代 `PRD.md`、`docs/ARCHITECTURE.md`、`docs/contracts/*.md`、`docs/frontend/*.md` 或 `IMPLEMENTATION_PLAN.md`。
- 若本文与上述 Source of Truth 冲突，按根目录 `AGENTS.md` 的冲突优先级处理；需要改变已确认合同则停止并返回 `/plan`。
- 当前用户只要求编写 Handoff，没有授权执行 R1、R2、R3 或 R4。
- 后续 `/execute` 的最小授权单位仍是单个编号批次；不得一次连续执行 R1-R4。
- R5（ReaderPage 拆分）与 R6（AnalysisPage 拆分）明确暂停，不得顺带实施。

## 1. 当前基线

### 仓库状态

- 审查最终基于 commit `557abca293401952f05894a8991b00c8b5868079`（`main`，提交说明：`做完了app`）。
- Handoff 编写前工作树为 clean。
- 下一位执行者开始前必须重新运行 `git status --short` 和 `git rev-parse HEAD`；不得假设基线仍未变化。
- 不自动提交、推送、清理用户文件或执行破坏性 Git 操作。

### 已验证事实

在 `app/` 下完成只读基线检查：

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run test`：9 个文件、38/38 通过。
- `npm run test:integration`：完整套件出现非确定性超时；最近一次为 26 个文件中 25 个通过，136/137 通过，`annotation-content-invariant.test.ts` 的双栏 PDF 用例在约 5.4 秒触发默认 5 秒超时。
- 定向运行 `annotation-service.test.ts` 与 `annotation-content-invariant.test.ts`：2 个文件、19/19 通过。
- `git diff --check`：通过。

结论：当前业务断言没有已确认失败，但完整 Integration Gate 会在 PDF/Python 负载下偶发超过默认 5 秒，不能报告为稳定全绿。

## 2. 审查原则与总边界

R1-R4 的共同目标是提高可读性、一致性和可维护性，同时保持功能、输出、状态转换、错误码和持久化格式不变。

必须保持：

- AnalysisRun 状态、合法转换、全局单活动 Run 和 Final immutable 合同。
- Provider retry 次数、Schema Repair 次数、超时边界和错误映射。
- Evidence Gate、正文 `content_hash`、PaperRecord revision 和 Markdown 冲突合同。
- Codex Prompt 的实际文本、中文输出要求、原语言 Evidence 要求和当前版本号。
- API 路径、SSE 对外字段、UI 文案、ARIA 名称及现有 E2E 可观察行为。

不得在 R1-R4 中实施：

- R5 ReaderPage 组件/Hook 拆分。
- R6 AnalysisPage 组件/Hook 拆分。
- 新功能、UI 改版、领域字段增删或状态机调整。
- Annotation journal/recovery、Final commit、Atomic Storage 的结构性重写。
- Retry Provider 进程取消修复；该问题属于功能行为变化，见第 8 节。
- 真实 Codex 调用，除非用户对相应批次另行明确授权。

## 3. R1 — 恢复可信测试基线

### 唯一核心能力

让现有自动质量门准确反映当前运行时合同，并在正常并行负载下稳定完成。

### 已确认问题

1. `app/src/application/codex-analysis-service.ts` 当前将概览 Run 标记为 `codex-paper-overview-v3`。
2. `app/tests/integration/codex-analysis-service.test.ts` 已断言 `v3`。
3. `app/tests/e2e/codex-live-smoke.spec.ts` 仍断言 `codex-paper-overview-v2`；真实 Smoke 即使成功也会在该处失败。
4. `app/vitest.integration.config.ts` 未设置 Integration 专用超时。
5. PDF-heavy 测试会反复启动 Python fixture/PDF 处理；完整套件下单条用例可能略超默认 5 秒，但定向执行通过。
6. 当前有 12 个 Integration 测试文件直接调用 `create_pdf_fixtures.py`，spawn、等待退出码和错误处理存在重复实现。

### 目标文件

必改候选：

- `app/tests/e2e/codex-live-smoke.spec.ts`
- `app/tests/integration/annotation-content-invariant.test.ts`
- `app/tests/integration/annotation-service.test.ts`
- `app/tests/helpers/pdf-fixtures.ts`（新增）
- 当前直接启动 `create_pdf_fixtures.py` 的 Integration 测试文件

仅当采用 Integration 统一超时策略时才修改：

- `app/vitest.integration.config.ts`

### 实施要求

1. 将 Live Smoke 的预期概览版本改为当前合同 `codex-paper-overview-v3`；不要反向修改运行时代码以迎合旧测试。
2. 新增共享 PDF fixture helper，统一：
   - `.venv/bin/python3` 路径解析；
   - fixture 脚本路径；
   - 子进程 `error`/`exit` 处理；
   - 非零退出码报错。
3. 逐文件迁移重复 helper，不用脚本批量改源码；保持各测试原有临时目录和隔离语义。
4. 对确实执行多轮 PDF 写入/提取的重型用例设置局部显式超时，建议先使用 `15_000 ms`。
5. 不建议直接全局提高所有测试超时；如果局部超时仍不能稳定通过，再记录证据并评估 `vitest.integration.config.ts`。
6. 不通过缓存可变 Vault、复用 PaperRecord 或跳过哈希检查来缩短测试。

### 验收

在 `app/` 下依次运行：

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:integration
npx playwright test tests/e2e/codex-live-smoke.spec.ts --project=chromium --list
git diff --check
```

通过条件：

- 两次完整 Integration 均全部通过，无 timeout。
- Live Smoke 枚举成功，源码中不再存在错误的 `codex-paper-overview-v2` 当前断言。
- 未启用 `LUMER_LIVE_CODEX_SMOKE=1`，因此不得把 `--list` 报告为真实 Codex 链通过。
- 完成后更新 `PROGRESS.md`，记录文件、测试、残余风险并暂停等待 R2 授权。

## 4. R2 — Codex 输出合同单一来源

### 唯一核心能力

消除 Codex Provider 输出结构在 Zod、手写 JSON Schema 和持久化领域 Schema 之间的多份维护及漂移风险。

### 已确认问题

当前相同或高度重叠的结构分别位于：

- `app/src/application/codex-analysis-service.ts`：`CodexPaperAnalysisOutputSchema`。
- `app/src/lib/ai-providers/codex-analyze-adapter.ts`：手写 `analysisOutputSchema()`。
- `app/src/domain/analysis-run.ts`：`DeepReadingSchema` 与 `PaperAnalysisSchema`。

已存在的字段约束漂移：Provider Output Zod 要求 `metadata_candidate.authors[]` 为 trim 后非空字符串，而手写 JSON Schema 只要求任意字符串。Codex CLI 约束因此可能接受随后被应用 Zod 拒绝的数据。

### 建议模块边界

新增：

- `app/src/lib/ai-providers/codex-analysis-contract.ts`

该模块负责：

- `CodexPaperAnalysisOutputSchema`
- `CodexPaperAnalysisOutput` 类型
- 从同一 Zod Schema 生成 Codex `--output-schema` 使用的 JSON Schema
- 当前 Analyze/Overview prompt version 与 schema version 常量

现有 `DeepReadingSchema` 若与 Provider 输出完全相同，应从 `app/src/domain/analysis-run.ts` 明确导出并复用；不得复制第四份结构。

### 实施要求

1. 先为当前手写 JSON Schema 建立 characterization tests，冻结其必要的 Codex-compatible 形状。
2. 使用当前 Zod 4 的 `z.toJSONSchema` 从 Provider Output Schema 生成 JSON Schema。
3. 验证生成结果至少保持：
   - 根对象和嵌套对象 `additionalProperties: false`；
   - 必填字段完整；
   - nullable 字段表示正确；
   - 非空字符串 `minLength`；
   - page 的整数、最小值和 nullable 规则；
   - 数组 item 约束。
4. 若 Zod 原生输出包含 Codex CLI 不支持的关键字，允许在同一模块增加一个小型、确定性的兼容转换；不得退回另一份独立手写全量 Schema。
5. `codex-analysis-service.ts` 只消费集中后的 Zod Schema、类型和版本常量。
6. `codex-analyze-adapter.ts` 只负责临时 schema 文件、CLI 参数和进程执行，不再拥有业务字段定义。
7. Prompt 文本保持逐字不变；R2 只集中版本常量，不顺带改写提示词内容。

### 测试要求

新增或调整测试以证明：

- 一组合法 Provider fixture 同时通过 Zod 与生成的 JSON Schema。
- 空作者、缺字段、额外字段、非法页码等 fixture 在两侧均被拒绝。
- Analyze Run 仍持久化原有 `prompt_version` 和 `analysis_schema_version`。
- Schema Repair 仍只执行一次。
- Overview 不携带 `--output-schema`。

### 验收

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run build
git diff --check
```

重点定向测试：

```bash
npx vitest run --config vitest.integration.config.ts \
  tests/integration/provider-task-contract.test.ts \
  tests/integration/codex-analysis-service.test.ts
```

真实 Codex Smoke 不是默认验收项。若用户明确授权真实调用，再运行 7C Smoke；否则必须写明“未执行真实 Provider 验证”。完成后更新 `PROGRESS.md` 并暂停等待 R3 授权。

## 5. R3 — 统一 SSE 传输层

### 唯一核心能力

为服务端 SSE envelope/response 和客户端 SSE 分帧建立一套共享、可测试的传输实现，同时保持每条业务路径的既有语义。

### 已确认重复

服务端分别实现 SSE：

- `app/src/app/api/analysis-runs/route.ts`
- `app/src/app/api/analysis-runs/[runId]/retry/route.ts`
- `app/src/app/api/papers/[paperId]/chat/route.ts`

客户端分别手写 chunk buffer 与 `data:` 解析：

- `app/src/components/reader/ReaderPage.tsx`
- `app/src/components/analysis/AnalysisPage.tsx`

### 建议模块边界

可新增：

- `app/src/lib/http/sse-response.ts`：仅服务端使用，负责 envelope 编码和标准 headers。
- `app/src/lib/http/sse-client.ts`：仅客户端安全代码，负责按 chunk 解析 `data:` frame。

不要把 Node/Next 服务端依赖导入客户端模块。

### 实施要求

1. 先为当前 wire format 建立测试，再替换调用点。
2. 保持现有 envelope 字段：`event_id`、`type`、`stage`、`provider`、`provider_session_id`、`model`、`text`、`analysis_run`、`error`。
3. 保持 `Cache-Control`、`Connection` 和 `Content-Type` headers。
4. 客户端 parser 必须正确处理：
   - 一个 frame 被拆到多个 chunk；
   - 一个 chunk 包含多个 frame；
   - `\n\n` 与 `\r\n\r\n`；
   - 非 `data:` 行；
   - stream 结束前后的剩余 buffer；
   - 非法 JSON 的现有失败语义。
5. Analyze、Retry、Chat 的业务判断仍留在各自调用方；不要创造一个知道所有页面状态的通用 Hook/Service。
6. 保持失败 Run 查询、completed 导航、cancelled 提示及 Chat 单次完成事件的当前行为。
7. R3 不修复 Retry AbortSignal；若在抽取过程中发现必须改变该行为才能继续，停止并返回说明。

### 验收

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run build
LUMER_E2E_PORT=3116 npx playwright test tests/e2e/lumer.spec.ts --project=chromium
git diff --check
```

必须增加 SSE parser/response 的单元测试，不能只依赖浏览器 happy path。完成后更新 `PROGRESS.md` 并暂停等待 R4 授权。

## 6. R4 — 简化 CodexAnalysisService 编排

### 唯一核心能力

减少 `CodexAnalysisService` 内部重复和嵌套，使 Source 校验、Provider attempt、Schema Repair 与 Run 落盘边界更清楚，同时完整保持现有状态机行为。

### 已确认重复与复杂点

`createDraft` 与 `createOverview` 重复：

- 请求解析；
- Provider availability 检查；
- PaperRepository/ExtractionRepository 创建；
- Paper/Extraction 存在性检查；
- `source_sha256` 一致性检查；
- Running Run 创建和 started 回调；
- Provider 完成信息写回。

`createDraft` 内还同时处理首次 Provider 调用、同 Run retry、Schema 校验、一次 Repair、失败落盘和 Draft 完成，理解成本较高。

### 建议内部边界

优先提取小而明确的私有函数，不引入通用框架：

- `parseAnalysisRequest(...)`
- `loadVerifiedAnalysisSource(...)`
- `startAnalysisRun(...)`
- `runInitialProviderTask(...)`
- `repairProviderOutputOnce(...)`
- `completeDraftRun(...)`
- `completePreviewRun(...)`

名称可按最终代码风格调整，但每个函数只承担一个状态边界。

### 实施要求

1. 先用现有 Integration Tests 冻结行为，再逐段提取。
2. `createDraft` 与 `createOverview` 可以复用 Source 加载和 Running Run 建立，但不能用大量 mode 分支合并成一个更难理解的巨型函数。
3. 保持：
   - Provider protocol error 才触发一次同 Run retry；
   - timeout/cancel 不触发第二次 Provider 调用；
   - Schema invalid 只 Repair 一次且续接原 Session；
   - 迟到结果不能覆盖 cancelled/interrupted；
   - Overview 进入 `preview`，不产生 PaperAnalysis、Evidence Gate 或 Final；
   - Retry 根据 `analysis_schema_version` 区分 Overview 与结构化 Draft；
   - 所有现有错误码、用户可见错误信息和 progress 文案。
4. 每个时间点只生成一次 ISO 时间并复用于同一状态更新，避免同一提交对象内出现无意义的毫秒差异。
5. 不修改 `app/src/domain/analysis-run.ts` 的状态合同，不修改 Repository 或 Coordinator 语义。
6. 不把 Prompt、Adapter 进程管理或 API SSE 重新塞回 Service；R2、R3 已建立的边界应保持。

### 验收

重点定向运行：

```bash
npx vitest run --config vitest.integration.config.ts \
  tests/integration/codex-analysis-service.test.ts \
  tests/integration/analysis-run-repository.test.ts \
  tests/integration/analysis-run-control-service.test.ts
```

完整质量门：

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run build
LUMER_E2E_PORT=3117 npx playwright test tests/e2e/lumer.spec.ts --project=chromium
git diff --check
```

完成后更新 `PROGRESS.md`，记录提取后的职责边界、验证和残余风险，并暂停。R4 完成不构成 R5 或 R6 授权。

## 7. R1-R4 建议顺序

固定顺序：

```text
R1 可信测试基线
  -> R2 Provider 输出合同单一来源
  -> R3 SSE 传输层统一
  -> R4 CodexAnalysisService 编排简化
  -> 暂停
```

原因：

- R1 先保证后续重构的质量门可信。
- R2 先消除 Schema/版本多份维护，R4 才能安全简化 Service。
- R3 先把传输职责移出页面和路由，避免 R4 再次跨层抽象。
- R4 最后只处理 Application Service 内部编排。

禁止并行修改 R2-R4：三者都会触及 Codex Analyze 边界，并行会增加合同漂移和冲突风险。

## 8. 已发现但未授权的功能风险

### F1 — Retry Stream 未中止 Provider 进程

当前初次 Analyze 路径向 `createOverview/createDraft` 传递 `AbortSignal`；Retry 路径没有：

- `app/src/app/api/analysis-runs/[runId]/retry/route.ts` 断流时只调用 `interrupt(...)`。
- `app/src/application/codex-analysis-service.ts` 的 `retryDraft(...)` 不接收 `AbortSignal`，调用 `createOverview/createDraft` 时也未传递。

已确认状态机能阻止迟到结果覆盖 `interrupted` 终态；但从代码路径推断，底层 Codex CLI 仍可能继续运行至完成或五分钟超时。该推断尚未用真实子进程断流测试验证。

处理规则：

- R1-R4 只记录，不修复。
- 若用户授权 F1，应作为独立功能批次：先补失败测试，再向 Retry Route → `retryDraft` → Provider Adapter 贯通 AbortSignal，验证 Run 终态和子进程均及时结束。

## 9. 明确暂停项

### R5 — ReaderPage 拆分

暂不执行。不得提取 Reader hooks、子组件或改变其 21 个局部 state 的组织方式。

### R6 — AnalysisPage 拆分

暂不执行。不得提取 Paper Card Editor、Evidence Panel、History 或 Markdown Conflict 组件。

R3 只允许把通用 SSE 传输解析移出页面；不得借此扩展为页面级组件重构。

## 10. 每批交接模板

每个 R 批次结束时，执行者必须在 `PROGRESS.md` 追加/前置一条简洁记录，至少包含：

- 当前建立的唯一能力；
- 实际修改文件；
- 实际执行的验证及结果；
- 未执行的验证；
- 残余风险；
- 下一最小授权批次；
- 明确说明已暂停、未自动进入下一批。

若任何批次需要修改已冻结合同、改变外部行为、降低测试门槛或无法保持现有 E2E 可观察结果，立即停止并返回 `/plan`。
