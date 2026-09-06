# Lumer Assistant MVP 实施计划

## 2026-09-06 补充授权批次：概览同步到 Obsidian

- 用户已批准完整批次：点击“同步到 Obsidian”即保存完整概览及版本，再同步 Markdown。该授权覆盖此前 preview 禁止 Final 的合同调整；不需再次确认。
- 小目标依次为：①更新概览 Final 合同；②接入原子提交/Current Final/同步及恢复；③补按钮、Final 全文与同步状态。概览用既有 `unstructured-text-v1` 区分，结构化 Evidence Gate 保留。
- 用户明确本批不需要测试验收，由用户自行操作；不执行自动测试、浏览器或截图验收，不报告验证通过。完成后更新 PROGRESS.md 并暂停，不进入其他 UI 改版批次。

**计划版本**：v1.9-final-paper-card-chat
**日期**：2026-09-05
**状态**：阶段 1、阶段 2（2A–2F）、阶段 3（3A–3D）、阶段 4（4A–4G）及阶段 5 原批次（5A-Chat、5B–5D）已完成自动验证；5E 基础合同与 5F Overview 产品接入已完成代码和自动验证，真实外部 Live Smoke/人工验收尚未执行。6H Library 解析结果入口及 6I Library 表格密度已完成代码和自动验证，人工验收待用户执行。2026-09-05 已重新规划阶段 7；不得自动进入 7A。
**源码起点**：Annot `d785f1dd25f6e5179023ad504b280058d8b179b8`

## 2026-09-06 Vortex UI 改版规划门（已确认，按批次实施）

- 用户已确认依据 `docs/frontend/vortex-ui-proposal.md` 分块串行修改前端，并补充液态玻璃、带透明感的表现。本节登记分批实施边界；完整四页视觉切换仍按 V2–V4 逐批收口。
- 当前 `docs/frontend/frontend-baseline.md` 与 `lumer-design-tokens.v1.json` 仍是已冻结 Source of Truth：Light-only、Desktop-only、1280px 最小宽度、四页 IA、Reader 两张操作卡冻结。Vortex 方案会改变主题/Token，因此在 V1 通过前不得直接覆盖生产 CSS。
- 最新范围约束：Library 可使用 Vortex 背景；PDF Reader 与 Analysis 完全不加载背景图、poster 或视频；Settings 采用统一深色外框但默认静态；PDF 页面本身保持原色。Reader/Analysis 的 PDF、Annotation、Evidence 定位、Final/Chat 门和两张冻结操作卡的布局/文案/行为不改。

### Vortex 串行批次

| 批次 | 唯一核心能力 | 目标文件 | 完成边界 |
|---|---|---|---|
| V1 | 视觉合同切换确认 | `docs/frontend/{frontend-baseline,lumer-design-tokens.v1.json,wireframes,ui-states}.md/json`、本计划、`PROGRESS.md` | 记录深色 Token、页面动静策略、背景素材/授权状态、冻结区和回退规则；不改 `app/src`。只有用户确认后才进入 V2。 |
| V2 | AppShell + Library 背景与主题 | `app/src/components/layout/{AppShell,GlobalRail,Topbar}.tsx`、`app/src/components/library/LibraryPage.tsx`、`app/src/components/layout/AmbientVideoBackground.tsx`（新增）、相关 CSS/静态资源 | 只让 Library 使用 PNG/HLS 背景；原生 HLS 优先、hls.js 按需、失败回退纯色/静态图；支持暂停、减少动态效果、后台暂停和销毁；保留 224px Secondary、搜索/筛选/导入/列表语义和 1280px 阻塞门。 |
| V3 | Reader + Analysis 深色工作区 | `app/src/components/reader/ReaderPage.tsx`、`app/src/components/analysis/AnalysisPage.tsx`、相关 CSS/Markdown 样式 | 仅适配外框、工具栏、面板、状态/表单/Markdown/Evidence 对比度；Reader/Analysis 不加载背景图、poster 或视频；PDF 原页、Annotation 坐标、Evidence 回跳、Final/Chat 门和两张 Reader 冻结卡不变。 |
| V4 | Settings 与全局状态收尾 | `app/src/components/settings/SettingsForm.tsx`、`app/src/components/ui/*`、相关 CSS、必要的回退资源与文案 | 统一表单、弹窗、Alert、Skeleton、禁用/错误/保存中状态；Settings 默认静态深色；不扩张配置 API、不回显凭据、不改变 Provider 合同。 |

### Vortex 批次纪律与验证门

- 每批只实施上表一个核心能力；完成后必须更新 `PROGRESS.md` 并暂停，不自动进入下一批。
- V1 自动验证仅限文档/JSON schema、`git diff --check` 与引用路径检查；用户需确认深色主题是否替代 Light-only、Library 动态背景范围、Settings 静态策略、Reader 两张冻结卡是否只开放配色。
- V2 运行 `npm run typecheck`、`npm run lint`、必要的 Library/布局定向测试和 `npm run build`；不把 HLS HTTP 200 当成解码成功。用户人工检查背景焦点、加载/失败回退、暂停/减少动态效果、列表密度和文字对比。
- V3 运行 `npm run typecheck`、`npm run lint`、Analysis/Reader 定向测试和 `npm run build`；用户人工检查 PDF 原页、标注坐标、Evidence 回跳、Chat 门、Markdown 滚动与长文对比度。
- V4 运行 `npm run typecheck`、`npm run lint`、Settings/UI 定向测试和 `npm run build`；用户人工检查表单填写、保存/失败/冲突/禁用状态及敏感信息脱敏。
- 按用户要求不调用浏览器或截图工具；真实视频解码、循环接缝、裁切、滚动和跨页交互由用户人工验收。任何需要改变四页 IA、业务状态机、Provider/API/Storage 合同或 Reader 冻结卡语义的请求，立即返回 `/plan`。

**Vortex 当前阶段门**：V1 视觉方向已由用户确认，V2 AppShell + Library 已完成代码并等待人工验收；V3 Reader + Analysis 已完成代码并等待人工验收；V4 Settings + 全局状态已完成代码并等待人工验收。Vortex UI 批次至此不再自动扩展。按 `V2 → V3 → V4` 串行，每批独立暂停。

## 2026-09-06 液态玻璃精修批次（G1 已授权）

- 用户确认从 G1 开始；Reader / Analysis / Settings 内容层（G3）不纳入本轮精修，三页既有 Vortex 代码保持不变。
- 本轮只在 Library / Tag 页面追加更明显的液态玻璃层次，按 `G1 → G2 → G4-lite` 串行；每批完成后更新 `PROGRESS.md` 并暂停。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| G1 | 共享外框玻璃层 | 仅 Library / Tag 的 AppShell、Rail、Topbar；新增独立作用域与统一 `--glass-*` tokens，增强透明底色、渐变反射、blur/saturate、边缘高光、内阴影和柔和 glow；不改内容层。 |
| G2 | Library 内容层玻璃层 | 仅 Library / Tag 的 Secondary、Main、搜索框、论文列表、空态与业务按钮；保持现有布局、文案、导入/筛选/排序行为。 |
| G4-lite | 玻璃视觉收口 | 只做 G1/G2 的定向自动验证与用户人工验收记录；不扩展 Reader / Analysis / Settings 内容层。 |

**Glass G1 阶段门**：G1 自动运行 `typecheck`、`lint`、布局定向测试、`build` 与 `git diff --check`；用户人工检查 Library/Tag 的 Rail、Topbar 透明融合、边缘高光、悬浮阴影、Tooltip 不被裁切，以及 Reader/Analysis/Settings 未被新增 G1 作用域影响。验收通过后才进入 G2。

## 0. 规范引用

- 产品范围：`PRD.md`
- 技术架构：`docs/ARCHITECTURE.md`
- Storage 合同：`docs/contracts/storage.md`
- Analysis / Evidence 合同：`docs/contracts/analysis.md`
- Provider / Session 合同：`docs/contracts/provider.md`
- API / Error 合同：`docs/contracts/api.md`
- C01–C08 追踪矩阵：`docs/contracts/TRACEABILITY.md`
- 前端基线：`docs/frontend/frontend-baseline.md`
- Final Design Tokens：`docs/frontend/lumer-design-tokens.v1.json`
- 四页低保真要求：`docs/frontend/wireframes.md`
- UI 状态矩阵：`docs/frontend/ui-states.md`
- 测试策略：`docs/testing/TEST_PLAN.md`
- 执行规则：现有 `AGENTS.md` + `AGENTS_EXECUTION_RULES.md`
- 实施事实：`PROGRESS.md`

本计划只回答“按什么顺序实现”。任何批次不得重新解释已冻结合同。

## 1. 实施目标摘要

MVP 主链：

```text
Settings 配置 Vault
→ 导入并校验 PDF
→ SHA-256 去重
→ Library
→ Reader / Highlight / Memo / Chat
→ Analyze Paper
→ Structured JSON
→ Schema Validation
→ Evidence Verification
→ Draft Preview / Edit
→ Evidence Gate
→ Final AnalysisRun
→ 确定性 Markdown
→ Obsidian Vault
→ 重启恢复与 Evidence 回跳
```

硬性非目标以 `PRD.md` 为准。

## 2. 分阶段执行计划

保留 7 个阶段，但真正执行、授权和验收的最小单位是编号批次。

批次纪律：

- 一个批次只建立一个核心能力，可以同时修改多个文件，但不得同时建立多个领域能力。
- 每个批次开始前明确输入、目标文件和验收命令；完成后立即更新 `PROGRESS.md` 并暂停汇报。
- 未经用户明确继续，不跨到下一批次；阶段验收不代替批次验收。
- 后续批次可以集成前序能力，但不得借集成之名提前实现后续合同。

**UI 规划门**：UI-B01、UI-B02、UI-NAV-02、UI-FLOW-01、UI-COPY-01 与 PLAN-UI-01 已全部确认。1D 的 Final Tokens、四页低保真与完整状态矩阵已于 2026-09-01 通过用户人工验收；阶段 2（2A–2F）与阶段 3（3A–3D）已完成，下一最小授权单位为 4A。

### 阶段 1：独立基线、架构合同与设计冻结

**目的**：依次建立可独立运行的 Lumer 基线及安全基线、冻结 Architecture / Data Contracts，再冻结可供后续页面实现直接消费的 Frontend Design Baseline。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| 1A | 复制源码与依赖 | 复制 Annot 源码快照、锁文件和必要资源；只得到可追溯上游基线，不重命名、不重构产品能力 |
| 1B | Lumer 独立化与基线验证 | 重命名 package、品牌、环境变量和存储 key，消除 Annot 运行时路径/API 引用；建立 typecheck、lint、unit test、build 命令并完成独立启动验证，不建设新领域功能 |
| 1B-S | Security Baseline | 只将 Next.js 从 `16.2.1` 显式升级到官方安全版本 `16.3.3` 并更新必要 lockfile；禁止 `npm audit fix --force`、无关依赖升级和功能开发；自动门及 Viewer/Annotation/Chat 基线全部通过后才冻结新独立基线 |
| 1C | Architecture / Data Contracts | 将 C01–C08 映射为最终模块边界、路由/API 职责、数据所有权、DTO/schema、错误码和测试责任；只冻结架构工件，2B/4A 再实现可执行 Schema 与 Repository |
| 1D | Frontend Design Baseline | 基于 `docs/frontend/` 已确认输入一次性冻结 canonical Final Design Tokens、四页真实低保真、导航、组件、区域尺寸和完整状态矩阵；只产出设计工件，不写业务代码 |

**1D Definition of Done**：

- 输出 canonical Final Design Token JSON，不再使用 `meta.status=candidate` 的输入文件充当最终工件。
- 四页真实低保真全部完成并覆盖 `docs/frontend/ui-states.md` 的每个状态，不以当前静态 Token 样本代替。
- 1460×900 基准画布、84px 全局栏、60px Topbar、380px AI Panel 及其他已批准 Token 均可追溯到低保真。
- 冻结 Library 二级栏精确宽度、Analysis 左右分栏比例、页面 padding/gap 和所有主要区域尺寸。
- 冻结基础组件选择、组件状态、图标规则、Tooltip、焦点态、禁用态和错误态。
- 冻结 `Library / Tag` 导航规则、Topbar Settings 入口及 Reader/Analysis 上下文入口。
- 冻结 Light-only、Desktop-first/V1 Desktop-only，以及最小支持窗口宽度和低于该宽度时的明确处理。
- 冻结简体中文 UI 文案规则、中文 Paper Card 与原语言 Evidence 的展示样例。
- 不实现 API、Vault、Repository、PDF、Provider、Analysis 或其他业务能力。

**阶段自动验证**：

- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:integration`
- `npm run build`
- `npm run test:e2e`
- 1B-S 执行 `npm audit --omit=dev`，不得用 `npm audit fix --force` 代替精确升级。
- `rg` 检查无 Annot 运行时路径依赖。
- C01–C08 对 Architecture / Data Contracts 的逐项 traceability 检查，无未归属字段、错误或写入责任。
- Final Design Token JSON schema 校验、四页/全状态覆盖检查和低保真浏览器截图回归。

**阶段人工验证**：

- 本地启动后能打开 Lumer 页面。
- 使用一个普通 PDF 验证 Viewer、Annotation 与 Chat 基线。
- 临时移走兄弟 Annot 后重新启动 Lumer。
- 用户逐页评审 1D 的真实低保真、状态矩阵、最小窗口宽度和基础组件选择。

**阶段门**：1A、1B、1B-S、1C、1D 各自暂停一次。正式顺序固定为 `1B-S Security Baseline → 1C Architecture / Data Contracts → 1D Frontend Design Baseline → 2A App Shell / Settings`；1D 未通过不得开始 2A。

**1B-S 返回 `/plan` 条件**：Next.js `16.3.3` 导致 Viewer、Annotation、Chat、production build 或现有测试出现核心兼容问题，且不能在不修改业务代码或无关依赖的前提下完成验证。

### 阶段 2：App Shell、Vault、PDF Pipeline、导入与 Library

**目的**：先按 1D 建立 App Shell 与可用 Settings，再建立无数据库的可信文件数据层，并在导入和 Reader 之前冻结 PDF 支持边界。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| 2A（2026-09-01 完成） | App Shell / Settings | 按 1D 实现全局 84px 图标栏、悬浮 Topbar、中文导航与 `/settings`；完成 Vault 手工输入、Provider 默认项、校验、原子保存和重启读取，不创建 Paper Repository 或导入能力 |
| 2B（2026-09-01 完成） | Atomic Storage + Schema | 建立版本化 schema、路径约束和 atomic-file Repository 基元；作为一个“可信文件存储合同”，不导入 PDF |
| 2C（2026-09-01 完成） | PDF Support Check + Extraction + Spike | 对普通、扫描、加密、损坏和边界 PDF 执行支持性检查与逐页提取；冻结 `max_file_bytes`、`max_pages`、`max_extracted_chars` 和估算 token 上限 |
| 2D（2026-09-01 完成） | Import + SHA 去重 + ExtractedPaper | 按 C02 生成 canonical PDF 路径，保存不可变 `source_sha256` 和提取结果；重复内容返回已有记录且不重复写入 |
| 2E（2026-09-01 完成） | Library 非破坏性管理 | 实现列表、搜索、查看以及 Status、Tags、Metadata 更新；永久删除入口与级联只在 6F 启用，避免两个阶段共同拥有删除能力 |
| 2F（2026-09-01 完成） | 移除 Folder 领域 | 删除 Folder UI/API/Session 分支，只保留 Inbox/Reading/Read 与 Tags；不触碰 Paper 删除合同 |

**阶段自动验证**：

- App Shell 只显示 `Library / Tag` 两个主导航按钮；Tag 不产生独立路由，Settings 从 Topbar 右上角可达。
- Config 保存、无效/只读 Vault 拒绝和重启读取。
- 临时 Vault 中 schema 校验、路径越界拒绝、atomic write 失败不留半文件。
- 单栏/双栏正文逐页提取；扫描、加密、损坏和超限 PDF 返回固定错误码。
- 同 PDF 重复导入只生成一个 PaperRecord；Annotation 未参与导入身份。
- Library 查询和非破坏性更新重启后保持。
- Folder 路由、组件、存储字段和 Session 分支均不再可达。

**阶段人工验证**：

- 2A 与 1D 的尺寸、导航、中文文案和 Settings 状态逐项一致。
- Settings 保存真实路径后重启仍恢复。
- 导入前可以明确预判支持或拒绝，并展示冻结后的拒绝原因。
- 导入论文后立即出现在 Library，重复导入打开已有论文。
- Status、Tags、Metadata 修改后重启仍保留，产品中不再出现 Folder。

**阶段门**：2C 结束必须展示 PDF Spike 数据并冻结 limits；2F 结束展示真实 Vault 文件树与 Repository 测试结果。

**返回 `/plan` 条件**：普通单栏/双栏 PDF 无法形成稳定的逐物理页正文，或合理阈值内的正文无法进入计划中的 Provider 输入合同。

### 阶段 3：Reader、Annotation 与 Page Bridge

**目的**：只负责消费阶段 2 已冻结的 Paper/PDF 数据，不再建设或调整 PDF 支持与提取 Pipeline。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| 3A（2026-09-01 完成） | Reader `paper_id` 化 | Reader 只通过 `paper_id` 和 Repository 加载托管 PDF，不接受任意业务文件路径 |
| 3B（2026-09-01 完成） | Annotation 重接 | 迁移 PyMuPDF Highlight/Memo 的创建、恢复和删除；不改变正文提取器 |
| 3C（2026-09-01 完成） | `content_hash` invariant 验证 | 已证明 Annotation 写入/删除与恢复前后阶段 2 的正文文本和 `content_hash` 不变；失败即停止，不用补丁绕过 |
| 3D（2026-09-01 完成） | Page Navigation Bridge | 已建立 `pdf_page_index`、显示页码与 Reader 物理页之间的单一映射和 `?page=<display_page_number>` 跳转入口 |

**阶段自动验证**：

- Reader 的无效 `paper_id`、缺失记录和路径越界均明确失败。
- `pdf_page_index=0` 对应 Reader 第 1 个物理页。
- 写入、恢复、删除 Annotation 前后正文文本与 `content_hash` 完全一致。
- Annotation Memo 不出现在正文或 Evidence 候选文本中。
- 页码桥接对首尾页、越界页和重启恢复均有测试。

**阶段人工验证**：

- 已导入的单栏、双栏 PDF 均可由 Library 打开。
- Highlight/Memo 写入、重启恢复、删除可用。
- 测试链接可跳到准确物理页。

**阶段门**：3C invariant 未通过不得执行 3D；3D 结束展示 Reader、Annotation 和物理页桥接实测。

**返回 `/plan` 条件**：Annotation 改变阶段 2 已冻结的正文提取结果，或 Reader 无法稳定使用物理页索引导航。

### 阶段 4：Mock Analyze Happy Path

**目的**：只跑通无并发、无取消、无外部修改、文件均存在的主链：`Mock Analyze → Draft → Verify → Final → Markdown → Restart`。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| 4A | Analysis Schema + Run Repository | 按 C03 建立 AnalysisRun schema、Repository、合法转换、draft revision 与全局活动 Run invariant；只预留关系字段，不实现 Final、Provider retry 或用户 Retry 行为 |
| 4B | Mock Analyze | 用确定性 fixture 创建符合合同的 Run 输出；总结字段默认简体中文，Evidence quote 保持 fixture 论文原语言；只验证 Analyze 入口到 Draft 的 happy path |
| 4C | Evidence Locator | 根据 C06 实现页级原文定位、标准化和审计结果；不决定 Finding 是否可 Final |
| 4D | Evidence Gate | 根据 C05 聚合 Finding/Evidence 验证结果，只给出门禁判定；不写 Final |
| 4E | Draft Editor | 编辑 Draft 字段并使受影响验证失效；“编辑 Final”先创建带 `derived_from_run_id` 的 Draft，不直接修改 Final |
| 4F | Final + History | 按 C04/C07 实现 `finalizing`、崩溃安全 commit point、不可变 Final、Current 指针与历史读取；不实现重新 Analyze 或 Markdown 冲突 |
| 4G | Markdown Renderer | 从 Current Final 确定性生成并首次写入 Markdown；不实现外部修改冲突分支 |

**阶段自动验证**：

- 合法 Mock JSON 进入 Draft；非法 JSON 不能创建 Final。
- Paper Card 总结字段默认为简体中文；原始 Metadata 与 Evidence quote 未被翻译或改写。
- C03 所有合法转换通过，非法转换、第二个全局活动 Run 和 `superseded` 状态均被拒绝。
- locator 对 exact、允许的 normalize、错误页唯一命中、未命中和歧义均有固定 fixture。
- 跨页、模糊、语义相似和多位置引文均不能得到 `verified`。
- Gate 不通过时不存在 Final commit 入口。
- 任一 Finding 无 verified Evidence，或 Final 保留任一非 verified Evidence，Gate 均失败且不可绕过。
- 编辑 Finding/Evidence 后相关验证按合同回到待验证状态。
- Final snapshot 不可原地编辑；旧 Final 保持 `finalized`，Current Final 指针和 History 在重启后恢复。
- PaperRecord commit point 使用 temp + fsync/close + atomic rename；指针更新前失败不改变旧 Final。
- commit point 同时把 Markdown 设为 `pending`；Markdown 失败不回滚 Current Final。
- 相同 Final JSON 生成相同 Markdown；本阶段只覆盖首次创建和应用未检测到外部修改的正常写入。
- Markdown 总结与应用内 Paper Card 同为简体中文，Evidence quote 仍与 PDF 原文一致。

**阶段人工验证**：

- 完整执行 `导入 → Reader → Mock Analyze → 编辑 → 回查 → Final → Markdown → 重启`。
- 重启后 Current Final、History、Evidence 回跳和 Markdown 均恢复。

**阶段门**：C03–C07 已冻结；4A–4G 仍按单一核心能力逐批暂停。4G 后用户评审 happy-path UI、状态展示和生成的 Paper Card。

**本阶段明确不做**：重新 Analyze、Markdown 外部冲突、取消、并发、Retry、缺失文件、失效 Vault 和删除。

### 阶段 5：Provider 接入与 OpenAI-compatible Overview 扩展

**目的**：保留 5A–5D 已完成的真实 Codex 能力，在不复制 AnalysisRun/Evidence/Final Runtime 的前提下，增加一个只用于论文纯文本概览的 OpenAI-compatible HTTP Provider。Claude Code 仍不属于 V1 Provider：只保留不可操作的“Claude Code（未接入）”按钮，不得探测、安装、登录、调用、持久化、fixture 模拟或验收 Claude Code。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| 5A | Analyze Provider Contract | 按 C08/UI-COPY-01 实现 Chat/Analyze 入口、输入输出、凭据边界、Session 隔离、默认中文总结、原语言 Evidence、版本和错误合同；只用 adapter fixture（已按旧双 Provider 合同完成，后续 5B 收敛为 Codex-only） |
| 5B | Codex Analyze Adapter + 范围收敛 | 只接通 Codex 的一次真实 Analyze 到 Draft，并将 Claude Code 从活动 Provider、配置、Session、CLI 探测和 fixture 范围移除；保留禁用占位按钮，不调用或测试 Claude Code |
| 5C | Schema Repair | 对完整 Codex 响应解析失败执行一次受限 repair；第二次失败终止，不触碰 Evidence Gate |
| 5D | Streaming / Provider Retry | 展示 Codex 阶段事件并实现 C03/C08 允许的同 Run Provider Retry；只处理单个分析任务，不处理多任务并发与取消竞态 |
| 5E（已实施） | OpenAI-compatible Provider 基础合同 | 建立 `ChatProvider`/`AnalyzeProvider` 分离、HTTP 环境配置解析、通用 Provider Status/Registry 和只支持 `overview` 的 Adapter；以 mock HTTP 完成合同测试。HTTP Chat 是后续 7C 的独立能力，不属于本批 |
| 5F（代码已实施，Live Smoke 待配置） | OpenAI-compatible Overview 产品接入 | 让现有 `POST /api/analysis-runs`、Retry、Settings 与 Reader 通过 Registry 显式选择 `openai_compatible`，生成可持久化/刷新恢复的只读 Preview；真实兼容 API Smoke 尚待用户配置。HTTP Chat 是后续 7C 的独立能力；结构化 Draft、Schema Repair、Evidence 与 Final 仍不扩展 |

#### 5E 详细范围与完成边界

**唯一核心能力**：建立一个安全、可测试、尚未进入产品分析入口的 OpenAI-compatible Provider 基础。

- 5E 的历史 Provider 类型分离：当时 `ChatProvider=codex`；`AnalyzeProvider=codex|openai_compatible`。第 7A 批次将按新批准合同扩展 ChatProvider，5E 不追溯承担该能力。
- 保持 `~/.lumer/config.json` schema 1 和字段结构不变，只扩宽 `default_analyze_provider` enum；旧配置和历史 AnalysisRun 必须继续读取，无批量迁移或历史重写。
- 新增一个服务端环境配置读取器，只接受 `LUMER_OPENAI_COMPAT_BASE_URL`、`LUMER_OPENAI_COMPAT_MODEL`、可选 `LUMER_OPENAI_COMPAT_API_KEY`；空白值按未配置处理。
- base URL 必须包含 `/v1`；远程只允许 HTTPS，HTTP 只允许 loopback；禁止跨 origin 携凭据重定向。
- Provider Status 改为 CLI/HTTP 可区分的 DTO；HTTP `/models` 检查硬超时 10 秒，不携带论文正文，不回显 endpoint、headers、API Key 或上游错误正文。
- 新增受限 Registry，只按固定 Provider ID 返回 Adapter/status；不得接收客户端提供的 URL、model、headers、class 或 module。
- OpenAI-compatible Adapter 使用原生 `fetch` 和非流式 `/chat/completions`，仅接受 `overview/new/no-session`；其他 task/session 组合在网络调用前拒绝。
- 请求体只含明确配置 model、system/user messages、`stream=false`；不增加 SDK、temperature、max tokens、tools、response format 或供应商私有参数。
- 响应必须有完整非空 `choices[0].message.content`；响应 model 缺失时使用本次明确配置的 model；task ID 优先使用响应 `id`，否则生成本地 UUID，并明确其不可 resume。
- 复用现有 300 秒 Overview 超时与 AbortSignal；HTTP 状态、网络、超时和响应解析错误映射到 C08 既有错误族，不暴露响应正文。
- 5E 不修改 `POST /api/analysis-runs` 的运行时选择、不修改 Reader/Analysis 行为、不执行 Live Smoke。

**5E 自动验证**：

- Config：缺失/空白变量、非法 URL、远程 HTTP、合法 HTTPS、合法 loopback HTTP、API Key 可选均有测试。
- Status：`/models` 的 200、401/403、5xx、超时、非法 JSON、配置模型缺失均有确定映射；任何返回对象不含 endpoint/API Key。
- Adapter：正确请求方法、URL、headers、最小 body；成功、空 content、错误 content 类型、缺失 choices、401/429/5xx、超时、abort 均有 mock HTTP 测试。
- Task support：`chat/analyze/schema_repair/resume` 在发出网络请求前拒绝；`overview/new` 返回统一 `ProviderStreamEvent/Result`。
- 回归：Codex Adapter、Chat Session、现有配置和历史 Run schema 测试保持通过；源码与测试 fixture 不出现真实密钥。

**5E 阶段门**：已完成自动验证并更新 `PROGRESS.md`；5F 已获单独实施授权。

#### 5F 详细范围与完成边界

**唯一核心能力**：将 5E 的 HTTP Provider 接入现有论文概览链，形成一个真实可用且可审计的只读 Preview。

- `POST /api/analysis-runs` 继续作为唯一创建入口；请求只允许 `paper_id` 与 `provider`，不得新增 `/api/model`、base URL、API Key、model 或高级参数字段。
- Analysis Service 从 Registry 解析所选 Provider；Codex 路径保持现有行为，`openai_compatible` 只进入 Overview → Preview，不得进入结构化 Draft/Repair/Gate/Final。
- Reader 从已保存的 `default_analyze_provider` 形成明确请求；UI 显示实际 Provider 名称，不再把所有分析状态和结果写死为 Codex。
- 5F 当时只允许为“论文分析”选择 `openai_compatible`；第 7C 才扩展“自由对话”选择。HTTP Provider 行显示配置/鉴权/可用性，并提示正文将发送到用户配置的服务。
- AnalysisRun 必须保存 `provider=openai_compatible`、实际/明确请求 model、独立 task correlation ID、prompt/schema version、完整 raw output 和 attempts；不得保存 endpoint/API Key/headers。
- SSE 仍只展示阶段事件与最终完整 Run；不得渲染半截模型输出。断开时先把 Run 置为 `interrupted`，再 abort HTTP fetch，迟到响应不得覆盖终态。
- 用户 Retry 创建新 Run、写 `retry_of_run_id` 并强制沿用原 Provider；不得通过 Retry 或失败处理 fallback 到 Codex。
- Preview 刷新/重启后可从 AnalysisRun 恢复；不创建 PaperAnalysis、Evidence Gate 结果、Final 或 Markdown。
- Claude Code 占位保持未接入、不可操作，不复用为 HTTP Provider 入口。

**5F 自动验证**：

- API/Integration：两个 Provider 均可经同一路由创建 Overview；无效 Provider、未配置、未鉴权、不可用、协议错误和超时返回批准错误，Current Final 不变。
- State/Recovery：HTTP 成功为 `preview`；取消、SSE 断开、迟到响应、用户 Retry、全局第二个活动 Run 与重启恢复符合 C03/C08。
- UI/Component：Settings 仅扩展 Analyze 下拉项；Chat 下拉/Route 仍拒绝新 Provider；Reader/Analysis 文案动态显示 Provider/model；Claude Code 仍禁用。
- Secret boundary：API/SSE/Run/日志/错误 envelope/页面均不出现 API Key、Authorization 或 base URL。
- 全量门：`npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:integration`、`npm run build`、Chromium E2E、`git diff --check` 全部通过。

**5F 人工与 Live Smoke**：

- 使用一个用户提供且由其确认可发送正文的 OpenAI-compatible 配置，对一篇支持范围内的真实普通 PDF 生成完整 Preview。
- 核对 Run 中 provider/model/prompt/schema/task ID，刷新页面和重启服务后仍能读取相同完整概览。
- 在真实调用期间取消或离开 Reader，确认 Run 不长期占用活动锁，且没有 fallback 到 Codex。
- Smoke 日志只记录结果状态和非敏感 provenance，不记录正文、API Key、Authorization、base URL 或上游完整错误正文。

**5F 阶段门**：Live Smoke、全量自动门和人工检查完成后更新 `PROGRESS.md` 并暂停，等待用户确认阶段 5 扩展；不得自动进入阶段 7。

**阶段自动验证**：

- Mock Codex/HTTP Adapter 合同测试，以及 Claude Code 占位按钮“未接入且不可操作”的组件断言；不创建 Claude adapter fixture。
- Provider Prompt/Schema 明确要求总结默认简体中文，但 Evidence quote 必须逐字保留论文原语言；翻译 quote 不得通过 Gate。
- Codex 缺失/未登录、HTTP Provider 未配置/未鉴权/不可用均返回明确错误且不 fallback；Chat 与 Analyze Session/task 不串用。
- JSON fence、前后多余文本、缺字段、错误类型、超时、流中断覆盖。
- Repair 只允许一次；第二次失败正确结束。
- Provider 失败和 Retry 不修改 Current Final。

**阶段人工验证**：

- 同一普通 PDF 使用 Codex 完成 Analyze，产生可编辑 Draft 并经过 Evidence Gate。
- 同一普通 PDF 使用 OpenAI-compatible Provider 完成纯文本 Overview，产生只读且可重载的 Preview，不创建 Draft/Final。
- Claude Code 按钮显示“未接入”且不可触发 Provider 调用、设置或 Session 写入。
- Chat 续接保持原行为，且不会混入 AnalysisRun 上下文。

**阶段门**：5A–5D 的历史完成状态不代表 5E–5F 自动完成。追加顺序已按 `5E → 5F` 执行；5F 代码与自动验证已完成，仍需用户提供配置和确认测试 PDF 执行 Live Smoke/人工验收后，才可关闭阶段 5。

**返回 `/plan` 条件**：OpenAI-compatible 服务不能以最小 `/models` + `/chat/completions` 合同工作；需要客户端提交 endpoint/key/model、多个配置档案、供应商私有协议；或结构化 Analyze 需要扩展到 HTTP Provider。Chat 正文预算与本地确定性选段由 7A 单独冻结，不回填 5E–5F。

### 阶段 6：Hardening

**目的**：不再建设 happy path，只补齐重分析、冲突、竞态、异常和不可逆操作。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| 6C（2026-09-02 完成） | Markdown Conflict | 按 C02/C07 实现取消、覆盖、另存、二次 hash 比较、canonical path 切换和 sync status；不反向解析 Markdown |
| 6A（2026-09-02 完成） | Re-analyze | 创建新 Run，Current Final 保持不动；只有新 Run 通过 6C 已实现的安全 Markdown 提交后才切换，旧 Final 保持 `finalized`，不使用 `superseded` |
| 6B（2026-09-02 完成） | Metadata Candidate | Analyze 只提出 metadata 候选，用户明确接受后才更新 PaperRecord；不与 Final commit 隐式绑定 |
| 6D（2026-09-02 完成） | 并发、取消与中断 | 强化全局单活动 Run、按钮/API 双重拒绝、取消、流中断、用户新 Run Retry 及其与同 Run Provider Retry 的竞态 |
| 6E（2026-09-02 完成） | Vault / PDF 异常 | 处理 Vault 失效、PDF 缺失、文件变更、原子 PaperRecord commit 失败和 `finalizing` 重启恢复 |
| 6F（2026-09-02 通过） | Delete Cascade | 一次确认后永久清理托管 PDF、PaperRecord、Extraction、Runs、Session 和当前受管 Card；不删除已退出管理的旧 Markdown，不建设废纸篓 |
| 6G（2026-09-02 通过；2026-09-03 调整） | Analyze liveness recovery | Codex Analyze/Schema Repair 单次调用硬超时 300 秒；超时失败不重试；Reader 卸载的 SSE 断开将中断 Run 并终止 CLI |
| 6H（2026-09-04 代码与自动验证完成；人工验收待用户） | Library 解析结果入口 | 文献库为每篇论文提供固定“查看解析”入口；服务端选择最近一次已生成的 Preview/Draft/Final Run，直接复用现有 Analysis 页面；不改变 Run 状态机、Current Final 或 Final commit |
| 6I（2026-09-05 代码与自动验证完成；人工验收待用户） | Library 表格密度 | 在不改变 Library IA、字段和 58px 行高的前提下，压缩标签徽标并为操作区提供稳定宽度；不新增业务状态或响应字段 |

**顺序调整（2026-09-04）**：已有顺序 `6C → 6A → 6B → 6D → 6E → 6F → 6G` 保持不变；新增 UI/Library 工作按 `6H → 6I` 执行。6H 先建立唯一入口数据合同，6I 只在入口稳定后调整表格布局。

#### 6H 详细范围与实现路径

**唯一核心能力**：在 Library 中固定提供一个“查看解析”入口，使已生成但尚未 Final 的 AnalysisRun 可以直接打开现有 Analysis 页面。

**用户可见规则**：

- 每个论文行的操作区始终保留一个名为“查看解析”的固定位置，替换当前只在有 `current_final_run_id` 时出现的 `Paper Card` 入口。
- 存在可进入的最近结果时渲染为 Link，显示文字必须是“查看解析”，目标严格为 `/papers/<paper_id>/analysis/<analysis_run_id>`；不得新增旁路页面或复制 AnalysisPage。
- 没有任何可进入结果时仍保留同尺寸的 disabled Button“查看解析”，不可点击，并通过 `title`/相邻辅助文案说明“尚未生成解析”；不得让行内其他按钮因该入口缺失而横向跳动。
- Link/Button 的 accessible name 使用“查看解析 <论文标题>”；可选的 `title` 只补充“打开最新 Draft/概览/Final”，不改变可见按钮文字。
- `Draft` 与 `Preview` 都属于“已生成解析”；`Finalized` 继续可从同一入口打开。`Finalizing` 只在它是 `paper.current_final_run_id` 且没有其他可进入结果时作为恢复期间的兜底入口。
- `running`、`failed`、`cancelled`、`interrupted` 永远不能成为“查看解析”的目标。失败 Retry 不能遮蔽此前仍可读的 Draft/Preview/Final。

**最近 Run 的确定性选择算法（服务端唯一决定）**：

1. `PaperLibraryService.list()` 读取 `PaperRepository.list()` 后，使用一个 `AnalysisRunRepository` 读取当前 Vault 的全部 Run；不得为每一篇论文在 UI 侧再发请求，也不得让浏览器根据时间自行猜测。
2. 按 `paper_id` 分组，只保留状态为 `preview`、`draft`、`finalized` 的 Run；`finalizing` 仅在其 ID 等于该 Paper 的 `current_final_run_id` 且前三类没有候选时保留。
3. 每组按 `updated_at` 降序选择第一项；若时间相同，按 `analysis_run_id` 字典序降序作为稳定 tie-break。不得优先硬编码 `current_final_run_id`，因为新的 Draft/Preview 应优先于旧 Final。
4. 映射为最小安全摘要，不携带 `raw_model_output`、Evidence、Prompt、凭据或其他大字段：`analysis_run_id`、`state`、`provider`、`model`、`updated_at`。
5. Paper 没有候选时返回 `latest_analysis: null`。现有 `has_current_final` 和 `paper.current_final_run_id` 语义完全不变。

**数据与 API 改动**：

- `app/src/domain/paper-library.ts` 新增 `LatestAnalysisSummary` 类型，并将 `PaperSummary` 扩展为 `latest_analysis: LatestAnalysisSummary | null`。状态类型只能取 `preview | draft | finalizing | finalized`，与上面的选择规则一致。
- `app/src/application/paper-library-service.ts` 增加纯读取的 Run 分组/排序/摘要 helper；保留现有搜索、状态、标签过滤和 PaperRecord 排序。任何 AnalysisRun 文件身份或 schema 错误继续按现有 data-integrity 路径失败，不吞错后生成空入口。
- `app/src/app/api/papers/route.ts` 不新增路由和查询参数，只让现有 `GET /api/papers` 自动返回扩展后的 `PaperSummary`。
- `docs/contracts/api.md` 更新 `PaperSummary` DTO 和“Library 只读聚合 AnalysisRun 摘要”的职责说明；不改变 `PaperDetail.current_final`、Final API、AnalysisRun schema 或 C03–C08。
- `PRD.md` 的 US-03 增加“可从 Library 进入最近已生成的 Draft/Preview/Final；未生成时入口禁用”的验收条款；`docs/frontend/ui-states.md` 补充 Library 行操作的有结果/无结果两种状态。四页 IA、`wireframes.md` 几何和 Design Tokens 不变。

**前端改动**：

- `app/src/components/library/LibraryPage.tsx` 使用 `latest_analysis` 渲染固定入口；只替换当前 `paper.current_final_run_id ? Paper Card : null` 分支，不改变阅读、编辑、删除按钮和删除 Dialog。
- 链接目标使用服务端返回的 `latest_analysis.analysis_run_id`，通过 `encodeURIComponent` 编码 Paper/Run ID；不能从标题、时间或当前浏览器状态拼接目标。
- 入口状态不显示额外新列，避免继续挤压表格；Final 列仍只表达 Current Final 是否存在，不把 Draft/Preview 误标成 Final。

**6H 测试与验收**：

- `app/tests/integration/paper-library-service.test.ts` 覆盖：无 Run 返回 null；单个 Draft/Preview/Finalized；多 Run 按 `updated_at` 选择；同时间按 ID 稳定选择；失败/取消/中断不入选；新 Draft/Preview 优先于旧 Final；Finalizing 仅按当前指针兜底。
- `app/tests/integration/paper-library-api.test.ts` 断言 `GET /api/papers` 返回最小 `latest_analysis` 摘要，并确认不包含 `raw_model_output` 或其他 Run 大字段；现有过滤合同保持通过。
- `app/tests/e2e/lumer.spec.ts` 增加真实 Mock 流程：导入 → 生成 Draft → 返回 Library → “查看解析”可见且 href 指向刚生成 Run → 点击后回到 `Draft Paper Card`；另验证没有 Run 时按钮 disabled、Final 后仍可打开同一入口。
- 6H 完成后运行 `npm run typecheck`、`npm run lint`、定向 Unit/Integration、`npm run test`、`npm run test:integration`、`npm run build`、Library 相关 Chromium E2E 和 `git diff --check`。
- 人工验收：分别用 Codex Draft、OpenAI-compatible Preview、Finalized 三种结果从 Library 点击“查看解析”；确认 Draft/Preview 不要求先 Final，失败 Run 不产生误导入口，刷新后目标稳定。

#### 6I 详细范围与实现路径

**唯一核心能力**：给 Library 操作列足够的稳定空间，同时缩小标签视觉占用。

- 只修改 `app/src/app/globals.css` 的 Library 表格相关选择器；不改 API、Domain、Analysis、Reader 或删除逻辑。
- 保持 58px `lumer-paper-row` 行高、表格圆角 12px、主区/Secondary 224px、最小窗口 1280px 和现有按钮语义/可访问名称。
- 将表格网格调整为稳定的操作列，目标值为：`gap: 8px`；论文列 `minmax(180px, 2.2fr)`；标签列 `minmax(82px, .8fr)`；年份 `46px`；状态 `70px`；Final `60px`；操作列固定 `292px`。该操作列可容纳四个约 68px 操作按钮及 3 个 4px 间距，并在 1280px 最小窗口内不依赖内容撑大。
- `.lumer-paper-row-actions` 保持单行 flex，按钮不换行；必要时显式 `min-width: 0`，避免新“查看解析”入口把操作列撑破。
- `.lumer-paper-tags` 的间距降为 `3px`；标签徽标目标为 `max-width: 64px`、水平内边距 `5px`、垂直内边距 `2px`、字号约 `8.5px`。必须继续显示文字标签、ellipsis 和 title，不改为仅颜色/图标。
- `.lumer-row-action` 保持 36px 高度和可读文字，宽度仍约 68px；不得把“查看解析/阅读/编辑/删除”改成没有文字的图标按钮，也不得引入第二套组件库。

**6I 测试与验收**：

- 增加或调整 Library E2E 的 computed-style 断言：操作列不发生横向溢出，四个操作入口在 1460×900 可见；1280×720 下页面保持桌面布局，不出现移动端折叠或遮挡。
- 运行 `npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:integration`、`npm run build`、相关 Chromium E2E 和 `git diff --check`。
- 人工验收重点检查：标签变小但仍能读；“查看解析、阅读、编辑、删除”四个入口不重叠、不被裁切；长标题/长标签有省略号；键盘 Tab 焦点仍可见；无结果的 disabled“查看解析”不影响其他按钮。

**6H/6I 明确不做**：

- 不新增 Analysis 页面、不新增 Library 路由、不在浏览器侧扫描 `.lumer/analyses`。
- 不把 Draft/Preview 写入 `PaperRecord.current_final_run_id`，不生成 Markdown，不自动 Final，不改变 Evidence Gate 或 FinalizationService。
- 不改变 Run 状态机、Retry、Provider 选择、Session 隔离、删除级联和 Current Final 历史。
- 不建设移动端布局、不降低到 1280px 以下、不通过横向滚动掩盖按钮拥挤、不执行截图/浏览器自动化以外的视觉重构。

**阶段自动验证**：

- 两次重新 Analyze 产生不同 Run，旧 Final 在新提交前后均按合同保留。
- 未接受的 Metadata 候选不修改 PaperRecord。
- Markdown 三分支、canonical path、`markdown_hash` 和 `markdown_sync_status` 更新正确；失败不回滚 JSON Final。
- 全局最多一个 `running/finalizing` Run；第二个 Analyze 的按钮与 API 均拒绝，取消终态和迟到流事件处理符合 C03。
- Provider 内部 retry 保持同 Run；用户主动 Retry 创建带 `retry_of_run_id` 的新 Run。
- Vault/PDF 异常与 Final 部分提交失败不会静默损坏 Current Final。
- 删除成功后不存在孤儿 PaperRecord、Extraction、Run、Session、受管 Card 或托管 PDF；失败结果可诊断。
- Codex Analyze 或 Schema Repair 超过 300 秒后，当前 Run 进入 `failed` 且 Provider 子进程终止；Reader 离开时 Run 进入 `interrupted`，不得永久占用活动锁。

**阶段人工验证**：

- 手工在 Obsidian 修改 Markdown 后逐一验证三分支。
- 分析期间重复点击、切换论文、取消、Retry 再返回，状态正确。
- 手工制造 PDF 缺失和 Vault 失效，确认错误可理解且已有 Final 不变。
- 删除确认明确列出对象；执行后不可恢复且界面无残留。

**阶段门**：按 `6C → 6A → 6B → 6D → 6E → 6F → 6G → 6H → 6I` 每批次独立暂停；6H 完成后暂停确认入口语义与 Run 选择规则，6I 完成后暂停确认表格密度；不得因 6H/6I 完成自动进入阶段 7。

### 阶段 7：Final Paper Card 门控的多 Provider 自由 Chat

**目的**：自由对话不是导入后的通用入口。它只能在用户完成可信 Paper Card 后出现，并基于已校验正文回答；Codex 与 OpenAI-compatible 可分别使用，绝不互相 fallback 或串用历史。

| 批次 | 唯一核心能力 | 通过条件 |
|---|---|---|
| 7A | 合同与上下文预算 | 将 Final Paper Card 门、双 Provider Chat、存储兼容、HTTP 外发边界和确定性正文段落选择写入全部 Source of Truth；按用户批准将 Chat 总上下文硬上限冻结为 250,000 estimated tokens |
| 7B | Paper Card 门控的 Codex Chat | Service/API 在 Provider 调用前验证 `current_final_run_id → finalized`；Codex Chat 基于 Extraction 片段，旧历史可继续 |
| 7C | OpenAI-compatible HTTP Chat | API 可选为 Chat Provider，使用独立历史与每次新 task；不会续接 task 或 fallback 到 Codex |
| 7D | Reader Chat Composer | 只有 Final Paper Card 后渲染截图式“随心输入”Composer，完成 UI、键盘和 Provider/异常 E2E |

**7A 合同与 Spike**：

1. `Final Paper Card` 的唯一程序门是 PaperRecord 的 `current_final_run_id` 指向同 Paper 的 `finalized` Run；`preview`、`draft`、`finalizing`、`latest_analysis` 或 Markdown 同步状态均不得替代这个判定。
2. 更新 `PRD.md`、`docs/ARCHITECTURE.md`、`docs/contracts/{provider,api,storage,TRACEABILITY}.md`、`docs/frontend/{frontend-baseline,ui-states,wireframes}.md`、`docs/testing/TEST_PLAN.md`；旧 5E–5F 的“HTTP 不进 Chat”只保留为历史批次边界，不能继续作为当前合同。
3. 新建版本化 Chat Context Limits Source：`max_estimated_tokens=250,000` 是用户批准的 Chat 单次请求总上下文硬上限，覆盖 system prompt、当前问题、有限同 Provider 历史与本地正文片段；它与 2C PDF 支持上限分离，也不声称外部 Provider 已稳定接受 250,000 tokens。超限必须在本地拒绝，不发送正文。
4. 正文选择只在本地执行：按页与自然段切分，保留标题/页码、当前问题、有限同 Provider 历史，使用可重现的关键词评分选段；文本均包在 `<untrusted_paper_text>` 中。禁止向量库、远程 RAG、盲传全文与客户端提交上下文。
5. Chat Session schema 仍为 storage schema 1：旧 `{sessions:{codex}}` 在读取时补齐 `openai_compatible:null`，完整写回时不丢旧消息；HTTP 槽位只保存应用历史和最近 task ID，不把 task ID 用于 resume。

**7B 服务端事实与边界**：

- `ChatService` 在读取 Session、Extraction 或调用 Adapter 前重读 PaperRecord 与目标 Run。无 Final Paper Card 返回 `PAPER_CARD_REQUIRED`（409、非 retryable），不得以 Reader 隐藏替代服务端门。
- Extraction 缺失、损坏或 `source_sha256` 不一致时拒绝，不发送任何正文；成功时由新的 `PaperChatContextBuilder` 生成带物理页码的上下文。模型只能依据给定片段回答，信息不足必须明确说明。
- Codex 首轮为 `new`，后续仅 resume 本 Paper × Codex Session；每轮仍携带当前选段。Chat 不读取/写入 AnalysisRun、Evidence 或 Final。
- 自动验证至少覆盖：无 Final 不调用 Adapter、不写 Session；Preview/Draft 不解锁；Finalized 解锁；旧 Final 在重新 Analyze 期间持续解锁；正文身份失败；首轮/续接 Prompt；旧 Session 自动迁移；同 Paper 并发拒绝。

**7C HTTP Chat 合同**：

- `ChatProvider`、Settings 和 Chat GET/POST 接受 `codex | openai_compatible`；浏览器只提交 Provider ID、message、intent 和选文，不提交 base URL、模型、Key 或高级参数。
- HTTP Adapter 仅增加 `chat + new + no-session`，复用 `/models` 状态检查、`/chat/completions`、Bearer 头、禁止跨 origin 重定向、非流式完整响应和错误映射；每次 Chat 用同一服务端环境 profile 新建请求。
- API Chat 重放本 Provider 的有限应用历史和本轮正文选段；Codex / HTTP 的 Session、模型、消息、task ID 必须严格隔离。401/403、超时、协议错误或不可用时保留输入和历史，不调用另一 Provider。
- 自动验证至少覆盖：Settings 可选 API 且不可用时禁选；HTTP 请求无凭据泄露、正文只在发送 Chat 后出现；HTTP 不 resume；两 Provider 历史隔离；失败不发 `completed`；删除仍级联清理双槽位 Session。

**7D Reader UI 合同**：

- 改动边界只从现有“自由对话”区域开始。截图所示的“标注与 Memo”卡和“生成论文概览 / 生成可信论文卡片”卡必须原样保留：不改 DOM 结构、文案、图标、尺寸、间距、边框、颜色、按钮、Provider 数据提示、disabled 条件或任何既有交互；快捷操作也不属于本批修改对象。
- `detail.current_final !== null` 只是 Reader 的预防性显示门；为空时不挂载 Chat 标题、历史、textarea、发送按钮，也不请求 Chat 历史。仅有 Preview/Draft 的论文外观与“无 Chat”默认态相同。
- Final Paper Card 存在后，空历史只渲染截图式 Composer：白色实线大圆角、多行输入、placeholder“随心输入”、右下角圆形 `Send` 图标。移除当前虚线空态、标题和文字发送按钮；Avenir Next、现有亮色编辑台 token 与 380px AI Panel 不变。
- 有历史时在 Composer 上方显示当前 Provider 的可滚动消息区；`⌘/Ctrl+Enter` 发送、Enter 换行、发送中防重复、失败保留输入。发送图标必须有可访问名称、focus-visible 环和 disabled 状态。
- E2E 断言无 Final 完全没有 Chat DOM/网络请求；Final 后才显示 Composer；Provider 切换恢复各自历史；HTTP 错误不 fallback。另对两张冻结卡做 DOM 文本、按钮可达性和计算样式回归，证明 Chat CSS 不外溢。人工验收只检查 Composer 的留白、圆角、图标位置和键盘体验，以及两张冻结卡与参考图一致；不以截图替代功能验证。

**阶段门**：严格按 `7A → 7B → 7C → 7D` 单批暂停。每批完成后更新 `PROGRESS.md`，执行其定向自动验证；7D 不自动进入第 8 阶段。

### 阶段 7E：Settings 自定义 OpenAI-compatible 配置

**状态**：`7E-01`、`7E-02` 已完成自动验证；`7E-03` 已完成代码与自动验证，待人工 Settings 验收。该阶段由用户于 2026-09-06 提出，用于替换原先“OpenAI-compatible 配置只能由服务端外部环境管理”的边界；每个批次仍单独暂停。

**目的**：在 Settings 提供本机自定义 API 配置窗口，将用户明确填写的服务名称、Base URL、模型和 API Key 安全同步到 `~/.lumer/config.json`；不把敏感值写入 Vault、Session、AnalysisRun 或 API 响应。

**范围假设**：

- “App”解释为用户可识别的服务名称/标签，保存为 `openai_compatible.app`；它只用于 Settings 展示和状态识别，不参与 Provider 请求路由。
- 自定义配置固定保存于 `~/.lumer/config.json`，由现有配置仓库以原子写入更新；不再新增 `.env.local` 写入链路，也不覆盖用户已有环境变量。
- 由于 API Key 进入本地配置文件，配置文件必须保持 `0600`；读取、错误、日志和响应均只返回脱敏状态，不返回 API Key 原值。
- 保存成功后同步当前进程内的 Provider 配置读取结果，使后续 Provider 状态检查可立即使用；不要求修改 `process.env`，也不写入 shell profile。
- 为兼容既有 5E–7D 部署，未配置 `openai_compatible` 对象时仍可读取现有 `LUMER_OPENAI_COMPAT_*` 环境变量；Settings 保存后的 `config.json` 配置优先，UI 不再写环境变量。
- 只删除截图对应 Settings 中的“数据发送边界”提示；Reader/Analysis 中合同要求的正文外发提示继续保留，除非用户另行授权扩大删除范围。

| 批次 | 唯一核心能力 | 完成边界 |
|---|---|---|
| 7E-01 | Provider 配置 schema 与原子读写 | 扩展 `~/.lumer/config.json` 为 schema 2，兼容旧 schema 1；新增 `openai_compatible` 的 App、URL、模型、API Key 受控读写；配置文件 `0600`；不改 Settings UI/API |
| 7E-02 | Settings Provider 配置 API | 新增独立的 Provider 配置读写 API（不扩张旧 `PUT /api/settings` 字段）；返回脱敏配置状态；支持保存、保留 Key、清除 Key、运行时刷新；禁止日志/错误/响应泄露 Key、完整 URL 或 Authorization |
| 7E-03 | Settings 交互窗口与提示删除 | 新增服务名称、Base URL、模型、API Key、保存/清除/刷新状态控件；保存后显示重启提示和 Provider 状态；删除截图中的 Settings 数据边界 Banner；不修改 Reader/Analysis 既有提示和两张冻结卡 |

**7E-01 文件与合同更新**：

- 扩展 `app/src/lib/config/lumer-config.ts`、`app/src/lib/config/lumer-config-repository.ts` 及相关测试；优先沿用现有原子写入、schema 严格字段和 `0600` 权限。
- 旧 schema 1 配置必须继续读取；首次保存自定义 Provider 时写为 schema 2（新增严格的 `openai_compatible` 配置对象），未知字段拒绝静默写回；迁移失败保持旧文件不变。schema 2 仍保留全部旧字段和语义。
- 更新 `docs/contracts/provider.md`、`docs/contracts/storage.md`、`docs/contracts/api.md`、`docs/ARCHITECTURE.md`、`docs/frontend/ui-states.md`，明确 `config.json` 可保存用户主动填写的 Provider 配置，API Key 仅限本机文件、服务端内存和上游 Authorization 请求头。
- `openai_compatible.base_url` 继续执行 HTTPS/loopback HTTP、必须包含 `/v1`、无用户名密码/query/hash 的既有 URL 合同；`model` 与 `app` 必须非空且长度受限；`api_key` 仅允许本地写入，不在任何 DTO 中回显。配置对象优先于旧环境变量，旧环境变量只作为兼容回退。

**7E-02 API 合同**：

- 新增建议路由 `GET /api/provider-config`、`PUT /api/provider-config`、`DELETE /api/provider-config/api-key`；旧 `/api/settings` 继续只处理 Vault 和默认 Provider。
- `GET` 只返回 `{ app, model, base_url_configured, has_api_key, config_file_present }` 等非敏感状态；是否返回完整 Base URL 需在执行前最终确认，默认不返回完整 URL，仅返回已配置状态。
- `PUT` 请求可包含 `app`、`base_url`、`model`、`api_key`；服务端先校验全部字段，再一次性更新配置文件；任一失败保持原文件和当前进程配置不变。
- API 必须保持同源校验、Node runtime、无请求体/日志/错误正文泄露；API Key 不能出现在 SSE、ProviderStatus、SettingsView、页面 HTML 或测试输出中。

**7E-03 UI 与删除范围**：

- Settings 新增“自定义 API”区块，提供 App/服务名称、API URL、模型、API Key 四项交互；API Key 使用密码输入，已存在时仅显示“已配置”，不预填真实值。
- 保存按钮在字段合法时启用；清除 API Key 需要单独确认，避免空白输入误删；保存后自动刷新 Provider 状态并提示“当前服务已更新，重启后对新进程生效”。
- 删除 `SettingsForm.tsx` 中截图对应的两个 `AlertBanner title="数据发送边界"`；保留 Provider 状态、不可用原因和 Reader/Analysis 数据边界提示。
- 不新增任意客户端 endpoint/model/key 字段提交到 Analyze/Chat 路由；业务调用仍只使用固定 Provider ID。

**自动验证与阶段门**：

- 7E-01：schema 1/2 解析与兼容回退、严格字段校验、原子失败回滚、`0600` 权限、URL/长度校验、Key 不出错信息。
- 7E-02：GET 脱敏、PUT 全量成功、空 Key 保留、DELETE 清除、跨源拒绝、写入失败不污染旧配置、运行时 Provider 状态更新。
- 7E-03：Settings 表单可保存/刷新/清除；不可用 Provider 的选择逻辑不回退；截图 Banner 消失；Reader/Analysis 原有提示和冻结卡 DOM 不变。
- 每批完成后运行对应定向 Vitest/Integration；7E-03 结束再运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:integration`、`npm run build`、`git diff --check`。不自动执行浏览器截图检查，人工验收由用户完成。

**明确不做**：不写入全局 shell profile；不上传或代理用户 API Key；不支持多个 Provider profile、任意 headers、temperature/tools 等高级参数；不修改 Codex 登录；不删除 Reader/Analysis 全部数据边界文案；不自动进入阶段 8。

### 阶段 8：V1 端到端验收与冻结

**目的**：证明不是“代码存在”，而是完整产品链和新 Chat 门控真实可用。

| 批次 | 唯一验收目标 | 通过条件 |
|---|---|---|
| 8A | 自动质量门 | `typecheck`、`lint`、unit、integration、build、`git diff --check` 全部通过 |
| 8B | Mock E2E | 使用固定 PDF 与 Mock Provider 完成完整主链、保存 Final Paper Card 后的 Chat，结果可重复且不依赖网络/真实模型 |
| 8C | Provider Live Smoke | 使用支持范围内真实 PDF，分别完成 Codex 与 OpenAI-compatible 概览 → Preview，以及已有 Final Paper Card 后的独立 Chat |
| 8D | Restart / Conflict / Delete E2E | 完成重启恢复、Markdown 三分支、重分析历史、Chat 历史隔离、异常保护和永久删除级联 |

**8B Mock E2E 主链**：配置临时 Vault，导入并去重；Reader 完成页码、Highlight、Memo；Mock Analyze 生成 Draft、编辑/验证 Evidence、保存 Final 与 Markdown；确认 Final 前没有 Chat，Final 后 Codex Chat 可用；重启恢复 Paper、Final、Chat 历史和 Markdown。

**8C Live Smoke 附加要求**：Codex 与 OpenAI-compatible 分别报告 Overview 的 provider/model/prompt/schema/version 与独立 Session/task ID；Overview 仍只为 Preview。用同一已有 Final Paper Card 分别发起两种 Provider 的 Chat，确认回答来自各自 History/正文上下文，HTTP 不产生可续接 Session，也不进入 Draft、Evidence Gate 或 Final。

**8D 生命周期 E2E**：重新 Analyze 时旧 Final 及 Chat 门持续有效；分别验证 Markdown 取消/覆盖/另存与 commit point 恢复；验证第二个 Analyze、取消、Retry、流中断、PDF/Vault 异常；验证无 Final 的 API Chat 拒绝、双 Provider Chat 删除级联和重启后历史隔离。

**冻结条件**：所有自动检查通过，Codex 与 OpenAI-compatible 的真实 Overview 和 Final 后 Chat 各至少一条通过；Claude Code 占位保持不可操作；HTTP Provider 只进入 Overview / Chat，不进入结构化 Draft、Schema Repair、Evidence 或 Final；不存在会损坏 PDF、JSON、Final、用户 Markdown 或跨 Provider Chat 历史的已知 P0 缺陷。

---

## 3. 计划批准门

完整计划批准门已开放：C01–C08、UI-NAV-01、UI-B01、UI-B02、UI-NAV-02、UI-FLOW-01、UI-COPY-01 与 PLAN-UI-01 均已确认并回写；2026-09-04 已批准 C08 的 OpenAI-compatible Overview 扩展及 5E–5F 两个追加批次。

Library 二级栏精确宽度、Analysis 分栏比例、基础组件选择和最小支持窗口宽度，已由 1D 产出、冻结并通过用户验收，不再属于规划阶段的未决合同。5E 与 5F 业务代码已实施；6H/6I 是用户于 2026-09-04 确认后的新增 Library 计划，6H 与 6I 代码及自动验证已完成，人工验收待用户执行，后续是否进入阶段 7 等待用户单独授权。

以下数值不属于当前遗漏的用户决策：`max_file_bytes`、`max_pages`、`max_extracted_chars` 与估算 token 上限按既定计划在 2C 通过真实 PDF Spike 产生证据后冻结，不能在规划阶段凭空指定。

批准本计划意味着同时接受：

- `PRD.md` 的 V1 产品范围与硬性非目标。
- `docs/ARCHITECTURE.md` 的技术口径、Annot 复用边界与模块职责。
- `docs/contracts/` 的 C01–C08、Vault 数据布局、Evidence Gate 与 Final commit 合同。
- 本计划的七阶段、编号批次顺序与逐批暂停评审。
- `docs/frontend/` 已确认的 UI Baseline、信息架构、状态矩阵与 1D 前端设计批次位置。
- V1 Evidence Verification 只做可复核 locator，不自动宣称语义蕴含成立。
- Paper 删除会永久清理其应用管理文件，不提供恢复。

项目已进入 `/execute`，当前实际批次和验证事实以 `PROGRESS.md` 为准；未经用户明确继续，不并行跳做后续功能。
