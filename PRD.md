# Lumer Assistant 产品需求文档（PRD）

**文档版本**：v1.7
**日期**：2026-09-05
**事实来源**：`IMPLEMENTATION_PLAN.md` v1.9-final-paper-card-chat 与 `PROGRESS.md`（截至 2026-09-05 的最新确认口径）
**上游源码起点**：Annot `d785f1dd25f6e5179023ad504b280058d8b179b8`（仅作复制裁剪起点，运行时零依赖）
**语言合同**：界面与 Paper Card / Markdown 总结默认简体中文；论文原始 Metadata 与 Evidence quote 保持论文原语言（UI-COPY-01）
---

## 1. Executive Summary

我们在为一位需要精读英文学术论文的单人研究者构建 **Lumer Assistant**。以用户自有 Obsidian Vault 为唯一业务数据根的本地 Web 应用——以解决论文阅读、AI 辅助分析与知识沉淀彼此割裂、AI 输出无结构且不可回查的问题。用户导入 PDF 后完成阅读与标注；只有论文经结构化 Analyze、Evidence Gate 和人工确认保存为 Final Paper Card 后，才可基于该论文进行自由对话。论文概览和自由对话均可明确选择 Codex 或一个由用户自行配置的 OpenAI-compatible HTTP Provider；HTTP Chat 只使用本地选择的正文片段和自己的应用侧历史。结构化 Codex 分析仍须通过 Schema 校验和确定性 Evidence Gate，才能经用户确认提交为不可变 Final 并派生 Markdown。HTTP Provider 不进入结构化 Draft、Evidence 或 Final。V1 成功标准包含自动质量门、Mock E2E、两个真实 Provider 的独立 Overview / Chat Smoke 以及重启/冲突/删除 E2E；Claude Code 仍只保留不可操作的 UI 占位。

---

## 2. Problem Statement

### 谁有这个问题

单人研究者（本项目用户本人）：需要持续精读英文 PDF 论文、借助大模型理解与总结，并把可信结论沉淀进 Obsidian 长期复用。V1 严格单用户、macOS、本地优先，不考虑多用户或团队协作。

### 问题是什么

同一条工作流目前被拆在三类互不相通的工具里：

- **PDF 阅读器**：只有标注能力，不产生结构化的理解结果；
- **AI 聊天窗口**：能总结，但输出无固定结构、引文无法回查原文、幻觉无法逐条核查，结论随会话消失；
- **Obsidian**：是唯一长期知识库，但论文卡片靠手工撰写，难以与原文页码精确对应。

本质缺口是：**缺少一个以证据为核心的单篇论文分析工具**——AI 的每条核心发现都应该能在 PDF 原文中定位、验证、经人工修改后再入库。

### 为什么痛苦

- **信任成本**：AI 总结"说得像真的"，用户无法逐条核对，不敢直接引用进自己的知识体系；
- **时间成本**：同一篇论文要在聊天里反复投喂、反复追问，结论无法沉淀为可复用资产；
- **沉淀成本**：笔记与原文页码脱节，日后写作引用时找不到可靠出处；
- **工具成本**：现有起点 Annot 具备阅读与 Provider 能力，但没有论文数据层、没有结构化输出合同、没有证据验证机制。

### 证据

- **Annot 源码只读审计**（2026-08-31，commit `d785f1dd`）：`/api/papers` 固定返回空数组（无论文数据层）；AI 仅收到 PDF 路径、由 CLI 自行读取（无结构化合同）；Markdown 仅为浏览器下载、不落盘。三项能力缺口经审计确认真实存在；
- **用户显式决策**（2026-08-31 产品边界确认）："Analyze 结果只有通过 Schema Validation 和 Evidence Verification 才能成为正式 Paper Card"——直接表达了对未验证 AI 输出的不信任；
- **历史文档失控实例**：原 v0.1 PRD 曾在 Library Folder 问题上出现两处口径冲突，最终由用户裁决彻底移除 Folder——说明缺少单一事实源会导致范围漂移，这也是本次重写 PRD 的直接动因之一。

> 🔶 **Assumption**：痛点严重度（如每周精读篇数、重复阅读耗时）未做量化基线；个人工具以定性痛点与用户显式决策为依据，不引入虚构统计。若未来对外发布，需补充量化证据。

---

## 3. Target Users & Personas

### 主要 Persona：研究者本人（单用户）

- **角色**：需要持续精读学术论文的研究者（项目所有者）；
- **平台**：macOS（Apple Silicon）；V1 明确 Desktop-only、Light-only；
- **技术水平**：高——能使用终端与 CLI，接受 localhost Web 形态，愿意在 Settings 手工输入 Vault 绝对路径（V1 不做原生目录选择器，用户已确认）；
- **语言**：界面与总结卡片默认简体中文；EEG、fMRI、LLM 等通行专业缩写不强制翻译；论文原文引文保持原语言；
- **目标**：把"读完 → 读懂 → 可信沉淀"压缩为一条可复核链路；
- **痛点**：见第 2 节；
- **使用规模**：🔶 **Assumption**：预计每周精读数篇论文，Library 为个人规模（几十篇量级）；V1 按个人规模设计文件存储，不预建数据库。

### 次要 Persona

V1 无。其他具有相同工作流的研究者属于 V1 之后的议题，当前不承诺。

### Jobs-to-be-Done

- 当我读完一篇论文时，我想得到一份**每条核心发现都能回查原文页码**的中文结构化卡片，以便确认 AI 没有编造；
- 当我修改 AI 的结论时，我想让系统**自动重新验证受影响的证据**，以便人工改动不会绕过验证进入正式版本；
- 当我保存正式卡片时，我想让它以**确定性 Markdown 进入我的 Obsidian Vault**，以便长期检索与写作引用；
- 当我重新分析同一篇论文时，我想**保留旧的正式版本作为历史**，以便对比与回查。

---

## 4. Strategic Context

### 业务目标（个人项目口径）

个人项目，无商业 OKR、无 TAM/SAM/SOM。目标为**个人研究工作流效率与知识资产沉淀**：分析结果可信、可回查、可复用；PDF、JSON、Markdown 全部落在用户自有 Vault 中，无云同步、无 Lumer 账号。OpenAI-compatible 是用户主动配置和选择的可选外部推理服务，不改变 Vault 数据主权，但使用时论文正文会发送到该服务。

### 竞争 / 替代方案

| 替代方案 | 关键缺口 |
|---|---|
| 通用 AI 聊天（网页/桌面） | 无结构合同、无证据定位，会话结束结论即蒸发 |
| Annot（源码起点） | 有 PDF 阅读 + Codex/Claude Provider，但无论文数据层、无结构化 Analyze、无 Evidence 验证、Markdown 不落盘 |
| 文献管理工具（Zotero 类） | 偏重元数据管理，深读与证据级验证缺失；多含云同步/账号模型，V1 明确不做 Zotero Sync |

**差异化定位**：证据可复核的单篇论文分析 + 本地文件主权（Vault 即数据根，Obsidian 直接可读）。

> 🔶 **Assumption**：以上对比基于产品常识与 Annot 审计，未做系统性竞品调研；对个人工具决策足够，若产品对外发布需补做竞品分析。

### Why Now

- **能力已具备**：Codex CLI 的本机登录态和既有 Provider port/Run/SSE 边界可继续复用；新增 OpenAI-compatible Adapter 无需建设第二套 Analysis Runtime；
- **源码起点已锁定**：Annot 快照（`d785f1dd`）提供 PDF 阅读、标注、Provider/Streaming 等可复用实现；
- **合同已全部冻结**：C01–C08 与全部 UI 交互合同（UI-NAV-01、UI-B01、UI-B02、UI-NAV-02、UI-FLOW-01、UI-COPY-01、PLAN-UI-01）均已确认，计划批准门已开放；
- **知识库已就位**：用户已有 Obsidian Vault 作为长期沉淀目标。

---

## 5. Solution Overview

### 方案描述

Lumer Assistant 是一个以用户在 Settings 手工配置的 Obsidian Vault 为唯一业务数据根的本地 Web 应用：

- 机器级配置：`~/.lumer/config.json`（仅 `schema_version`、`vault_path`、`default_chat_provider`、`default_analyze_provider` 四项非敏感字段，不含任何密钥）；
- 可选 HTTP Provider 配置：仅从服务端环境读取一个 OpenAI-compatible base URL/model/API Key 档案，不进入 Vault、Lumer 配置、浏览器或 AnalysisRun；
- 业务数据：`<Vault>/.lumer/`（papers / extractions / analyses / sessions）；
- 用户可见产物：`<Vault>/Papers/`（托管 PDF）与 `<Vault>/Paper Cards/`（生成的 Markdown 卡片）。

JSON 是唯一正式结果（Source of Truth）；Markdown 是 Final 提交后的单向派生输出，应用永不反向解析 Markdown。

### 纵向主链（MVP 必须跑通）

```text
Settings 配置 Vault
→ 导入并校验 PDF
→ SHA-256 去重
→ Library 管理
→ Reader 阅读 / Highlight / Memo / Chat
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

### 核心分析链路（用户流）

```text
导入 PDF ──► SHA-256 去重 ──► Library ──► Reader（阅读 / Highlight / Memo）
                                 │
                                 ▼
                       Analyze Paper（每次新建 AnalysisRun）
                                 │
                                 ▼
                    Evidence Gate → Final Paper Card → 自由 Chat
                                 │  收集完整响应 → 严格 JSON 解析 + Schema 校验
                                 │  （解析失败：同 Run 内一次受限修复 → 再失败即 Run failed）
                                 ▼
                       Evidence Verification（确定性页级定位，无第二个模型）
                                 ▼
                       Draft（用户编辑；改动会使受影响证据自动失效重验）
                                 ▼
                       Evidence Gate ──不通过──► 无 Save as Final 入口（无人工绕过）
                                 │ 通过
                                 ▼
                    Save as Final（崩溃安全原子 commit point）──► 确定性 Markdown 写入 Vault
                                 ▼
              旧 Final 保留为历史 Run；重启后 Vault / Reader / Final / History 全部恢复，
              点击 Evidence 可回跳 PDF 精确物理页
```

### 关键能力清单

1. **Vault 配置**：手工输入绝对路径，校验后原子保存，重启恢复；未配置时 Library 阻塞式 onboarding；
2. **导入与去重**：流式 SHA-256 去重；重复内容直接打开已有 Paper；`source_sha256` 持久化且永不被 Annotation 写入改变；
3. **Library**：Inbox / Reading / Read 状态 + Tags，标题搜索与筛选，Metadata 编辑（Analyze 只给候选、不静默覆盖），Current Final 状态展示，一次确认永久删除；
4. **Reader**：`paper_id` 化加载托管 PDF；Highlight/Memo 写入标准 PyMuPDF Annotation 并重启恢复；Annotation 内容绝不进入正文与证据；内部 0-based 页索引与展示页码桥接；
5. **自由 Chat**：只有已有 Final Paper Card 的论文才显示；与 Analyze 完全隔离，按 Paper × Provider 持久化。Codex 跨重启续接其 Session；HTTP 每次新建 task、由应用重放自己的有限历史；解释选中文本 / 翻译走 Chat 入口，不写入分析结果；
6. **Analyze Paper**：全局最多一个活动 Run（服务端强制）；Codex 或 OpenAI-compatible Overview 均创建新 Run，正文作为带页标记的非可信数据传入；HTTP Provider 结果止于只读 Preview；Codex 结构化输出继续遵守中文总结与原语言 Evidence quote；
7. **证据验证与 Gate**：确定性 locator（exact → normalized → 全文），禁止模糊/语义/跨页匹配；每个 Finding 至少一条 verified Evidence，Final 保留的证据全部 verified，不可绕过；
8. **Final 与 Markdown**：不可变 Final + 历史保留；崩溃安全原子 commit point；Markdown 外部修改按"取消/覆盖/另存"处理；Markdown 失败不回滚 Final。

### 信息架构与 UI（已冻结合同）

| 路由 | 职责 | 固定区域 |
|---|---|---|
| `/` | Library | 84px 全局图标栏之外：224px Library 二级导航/筛选栏 + 论文列表 |
| `/reader/<paper_id>` | PDF Reader + AI Panel | 顶部阅读工具栏 + PDF 主区 + 380px AI Panel |
| `/papers/<paper_id>/analysis/<run_id>` | Draft / Final / History / Evidence Gate | 左侧卡片编辑区 + 420px 证据审核区；1460px 基准画布约 70/30 |
| `/settings` | Vault + Provider | 最大宽度 880px 的单列设置内容 |

- 全局导航：84px 窄型悬浮圆角图标栏，仅 `Library` 与 `Tag` 两个图标按钮；`Tag` 不建独立路由（回到 `/` 切换为 Tag 视图）；Settings 入口固定在 Topbar 右上角；
- AI Panel 操作优先级固定为：`分析论文（主操作） → 解释选中文本 / 翻译 → 自由对话`；
- 设计基线：1460×900 基准画布、Avenir Next、Hue 225° Light-only、Desktop-first（V1 Desktop-only）、悬浮圆角 Topbar（60px 布局行、50px 容器、圆角 16px、顶部外边距 10px）；最小支持窗口为 1280×720，宽度不足时显示阻塞提示，不折叠为移动端；
- ✅ **1D 验收门**：canonical Token、四页低保真、基础组件与原完整状态工件已于 2026-09-01 通过用户逐页人工验收；5F 只追加 Provider 状态与动态文案，不改变布局和设计 Token。

### 领域合同骨架

实现级细节以实施计划第 5 节为准，此处仅登记合同与其落地位置：

| 编号 | 合同（一句话） | 主要落地批次 |
|---|---|---|
| C01 | 配置/业务/可见产物三区分离：`~/.lumer/config.json` 机器配置，`<Vault>/.lumer/` 业务数据，密钥永不入库 | 2A–2B |
| C02 | 文件命名与重名：`<safe-stem>--<id-short>.pdf`、`<safe-title>--<id-short>.md`；SHA-256 定身份；"另存新文件"才切换 canonical path | 2D、4G、6C |
| C03 | AnalysisRun 状态机：running→draft→finalizing→finalized（含 failed/cancelled/interrupted）；全局最多一个活动 Run | 4A、5D、6A、6D |
| C04 | Final 不可变："编辑 Final"复制为新 Draft（`derived_from_run_id`）重新过 Gate，历史 Final 永不修改 | 4E–4F、6A |
| C05 | Finding Gate：每个 Finding ≥1 条 verified Evidence，Final 保留证据全部 verified；不可绕过 | 4D–4F |
| C06 | Evidence 定位：exact→normalized→全文三级匹配；禁止模糊/语义/跨页；保留完整审计字段 | 4C–4D |
| C07 | Final commit：崩溃安全原子 commit point；Markdown 为派生输出，失败/冲突不回滚 Final | 4F–4G、6C、6E |
| C08 | Provider 边界：Final Paper Card 后的 Chat / Overview 可选 Codex/OpenAI-compatible；HTTP 配置仅服务端环境；Session/task 隔离、无伪 fallback；Claude Code 仅为不可操作 UI 占位 | 5A–5F、7A–7D |

---

## 6. Success Metrics

### 主指标：V1 端到端验收全绿

V1 完成要求第 7 阶段 Chat 能力和第 8 阶段四个验收批次全部通过，且 5E–5F 已独立通过：

- **8A 自动质量门**：typecheck、lint、unit、integration、build、`git diff --check` 全部通过；
- **8B Mock E2E**：固定 PDF + Mock Provider 跑通完整主链与 Final 后的 Chat，结果可重复、不依赖网络与真实模型；
- **8C Provider Live Smoke**：同一支持范围内真实 PDF 分别由 Codex 与 OpenAI-compatible 完成独立 Overview → Preview 和 Final 后自由 Chat；任一结果不得替代另一条证据；
- **8D 生命周期 E2E**：重启恢复、Markdown 三分支、重分析历史、Chat 历史隔离、异常保护、永久删除级联。

| 维度 | 当前基线 | 目标 |
|---|---|---|
| 追加 Provider 批次通过数 | 0/2（5E–5F 仅完成规划与合同冻结） | 5E、5F 分别通过并完成用户验收 |
| 已知 P0 缺陷 | — | 0（不允许存在会损坏 PDF、JSON、Final 或用户 Markdown 的已知缺陷） |

### 次要指标

| 指标 | 目标 |
|---|---|
| 真实论文全链可用性 | 用户至少用 1 篇真实论文完成"导入→分析→编辑→Final→Markdown→重启恢复"完整闭环（人工验收） |
| Provider 真实链可审计性 | Codex 与 OpenAI-compatible 分别跑通并报告 provider/model/prompt/schema/Session-or-task ID；HTTP 配置和凭据不进入运行记录；Claude Code 不产生运行时记录 |
| 批次纪律 | 每批次完成即更新 `PROGRESS.md` 并暂停；零跳批、零越权并入后续能力 |
| 重启恢复完整率 | Paper / Reader / Current Final / History / Markdown 基线 100% 恢复（E2E 断言） |
| 拒绝行为可理解性 | 扫描件、加密、损坏、超限 PDF、Provider 缺失/未登录均返回明确错误与中文提示（测试覆盖） |

### 护栏指标（不允许变差）

- **数据损坏事件 = 0**（P0 定义：损坏或丢失托管 PDF 正文、任何 JSON、已提交 Final、用户 Markdown）；
- **Gate 后证据 verified 率 = 100%**：Final 中不允许保留任何 pending/failed/ambiguous/not_found 证据；
- **Markdown 生成确定性 = 100%**：相同 Final JSON 必须产出逐字节相同的 Markdown 正文；
- **"伪通过" = 0**：Mock 通过不等于真实 Provider 通过，一个 Provider 通过不等于另一个 Provider 通过，页面可打开不等于重启恢复通过，Zod 通过不等于 Evidence 通过，引文存在不等于 Finding 语义正确；Claude Code 占位按钮不等于已接入 Provider。

> 🔶 **Assumption**：V1 不建设遥测，上线后的持续使用指标（如每周完成闭环的论文数、卡片编辑率）依赖人工观察，不设自动化度量。

---

## 7. User Stories & Requirements

### Epic 假设

我们相信，为单人研究者提供一个"导入 → 阅读 → 可选 Provider 概览 → 结构化分析 → 证据逐条验证 → 人工编辑确认 → 归档 Obsidian"的本地工具，将使 AI 辅助论文精读从"不可信、一次性"的聊天输出，变为"可回查、可沉淀"的知识资产。我们将以阶段 7 的端到端验收、Codex 真实链路和 OpenAI-compatible 独立 Overview Smoke 验证这一假设。

### 用户故事与验收要点

**US-01 Vault 配置（Settings）**
作为用户，我希望在 Settings 手工输入并保存 Vault 绝对路径，以便应用知道在哪里读写我的数据。
- 路径必须为绝对路径、存在、为目录、具备读写权限；`.obsidian/` 存在时显示"已识别 Vault"，否则允许使用但提示尚未初始化；
- 配置原子保存至 `~/.lumer/config.json`，重启后恢复；不含任何密钥字段；
- 未配置 Vault 时 Library 显示阻塞式 onboarding，不自动创建未知路径；
- Vault 失效或无权限时进入 Settings 修复，不回退临时目录；
- 状态覆盖：Valid / Invalid Vault / Provider Missing / Provider Not Logged In / Save Error。

**US-02 导入与去重**
作为用户，我希望导入 PDF 时自动校验并按 SHA-256 去重，以便同一篇论文不产生第二条记录。
- 依次校验扩展名、PDF 文件头、基本可读性，然后流式计算 SHA-256；
- 命中重复时不写文件，直接打开已有 Paper（文件名不同也识别；同名不同内容创建不同 Paper）；
- `source_sha256` 持久化，此后写入 Annotation 永不改变它；
- 扫描件、加密、损坏、超限 PDF 返回明确不支持错误，不产生半成品记录；
- 托管 PDF 按 C02 命名写入 Vault，临时文件 + 原子 rename。

**US-03 Library 管理**
作为用户，我希望用状态和标签管理文献库，以便聚焦待读与已读论文。
- 仅 Inbox / Reading / Read + Tags；Folder 领域彻底移除（UI/API/存储字段均不可达）；
- 标题搜索、状态/标签筛选、Metadata 与 Tags 编辑；
- Metadata 人工编辑后不被 Analyze 静默覆盖（Analyze 只产生候选，用户确认后才更新）；
- 列表展示是否存在 Current Final；
- 可从 Library 进入最近已生成的 Draft、Preview 或 Final；尚未生成解析时保留禁用的“查看解析”入口；
- 永久删除：一次确认且明确列出全部将删除对象（托管 PDF、PaperRecord、Extraction、全部 Runs、Session、当前受管 Card）；已"另存退出管理"的旧 Markdown 不删除；无废纸篓与恢复机制。

**US-04 Reader 与标注**
作为用户，我希望在 Reader 中阅读托管 PDF 并做 Highlight/Memo，以便精读与后续回查。
- Reader 仅通过 `paper_id` 从 Repository 加载，不接受任意文件路径；
- Highlight/Memo 继续写入托管 PDF 的标准 PyMuPDF Annotation，并支持重启恢复与删除；
- Annotation 内容绝不进入正文提取结果或 Evidence 候选；Annotation 写入前后正文 `content_hash` 不变（invariant 有测试）；
- 内部 0-based `pdf_page_index` 与 1-based 展示页码唯一映射；Evidence 点击跳转精确物理页；
- PDF 缺失、损坏或被替换时显示明确错误，不自动创建新 Paper。

**US-05 自由 Chat**
作为用户，我希望在可信 Paper Card 已生成后与单篇论文进行自由对话并跨重启续接，以便追问可信分析而不污染分析结果。
- Chat 的硬前提是 `current_final_run_id` 指向该 Paper 的 `finalized` Run；Preview、Draft、运行中或失败 Run 均不显示且不能调用 Chat；
- Chat Session 与 AnalysisRun 完全分离；按 Paper × Provider 存储于 `.lumer/sessions/`。Codex 续接专属 Session；HTTP 不续接 task，仅重放自己的有限应用侧历史；
- 每次 Chat 基于已校验的 Extraction 正文片段回答；正文片段在本地确定性选择并带物理页码，不能把模型回复当 Evidence；
- 解释选中文本 / 翻译使用 Chat 入口与当前选中文本，结果不写入 PaperAnalysis；Claude Code 按钮仅显示“未接入”，不创建 Session。

**US-06 Analyze Paper**
作为用户，我希望对单篇论文发起结构化分析，得到可校验的 PaperAnalysis JSON 草稿。
- 全局最多一个 `running/finalizing` Run：由服务端 Analyze Coordinator 强制，第二个入口 UI 禁用 + API 返回 `ANALYZE_ALREADY_ACTIVE`；
- 每次分析创建全新 Codex Session 与新 Run；校验 Codex 已安装、已登录，不满足则明确失败；
- 正文以带页标记的形式作为非可信数据传入，正文中的指令不得覆盖系统 Prompt；
- Streaming 仅展示阶段状态与错误，不渲染半截 JSON，不长期保存中间事件；
- 收集完整响应后严格 `JSON.parse` + Schema 校验；失败时同 Run 内执行一次"只修结构"受限修复，再失败则 Run `failed`、无可保存卡片；
- 分析输出默认简体中文总结；Evidence quote 保持论文原语言，翻译文本不得替代原文。

**US-06A OpenAI-compatible 论文概览**
作为用户，我希望在 Codex 之外选择一个自己配置的 OpenAI-compatible 模型生成论文概览，以便更换推理服务而不破坏 Lumer 的分析记录和安全边界。
- 可在“论文分析”及“自由对话”分别选择 `openai_compatible`；自由对话仍须先有 Final Paper Card；
- HTTP Provider 配置只来自服务端环境变量，Settings/API 不输入或显示 base URL、API Key、model；
- 用户启动前可看到“论文正文将发送到所配置服务”的明确提示；仅状态检查不得发送正文；
- 使用现有 `POST /api/analysis-runs` 和全局单活动 Run，不新增旁路 `/api/model`；
- 每次调用创建新 Run 与不可续接 task ID，完整 Markdown 结果保存为只读 `preview`，刷新和重启后可恢复；
- 不生成 PaperAnalysis、Evidence、Draft、Final 或 Markdown，不执行 Schema Repair；
- 未配置、未鉴权、不可用、超时、取消或协议错误均明确失败，不得 fallback 到 Codex；
- Retry 创建新 Run 并沿用 `openai_compatible`，不得借 Retry 更换 Provider。

**US-07 Evidence Verification**
作为用户，我希望每条 Evidence 都被确定性定位到 PDF 原文，以便核对 AI 是否逐字引用。
- 匹配顺序：模型报告页 exact → 模型报告页 normalized → 全文 exact → 全文 normalized；
- 仅允许确定性标准化（NFKC、soft hyphen、空白折叠、断词连字符连接、引号/破折号统一）；禁止模糊匹配、编辑距离、Embedding、LLM/语义相似度；
- 全文唯一命中允许校正模型页码并在界面标记"页码已校正"；多位置命中为 ambiguous、零命中为 not_found；
- 一条 Evidence 必须完整落在一个物理页内；跨页引文必须拆分后重新验证；
- 永久保存 `model_quote`（模型原始输入）与 `source_quote`（真实命中原文）、物理页、0-based 字符 span、实际执行的标准化步骤与 `content_hash`；任一缺失不得置为 verified；
- 只有当前正文 `content_hash` 与 Run 记录一致时才可验证。

**US-08 Draft 编辑**
作为用户，我希望直接编辑分析草稿，以便修正结论并保持证据可复核。
- 编辑即时保存 Draft，页面切换不丢失；
- 修改 Finding claim、Evidence quote 或页码后，相关 Evidence 立即失效并重新验证；
- 每次保存递增 `draft_revision`；
- "编辑 Final"复制为带 `derived_from_run_id` 的新 Draft，历史 Final 不可变；重新分析不复用该 Draft；
- Paper Card 中模型事实与用户笔记分字段呈现，Renderer 不混写。

**US-09 Final 提交与 Markdown**
作为用户，我希望把通过验证的草稿保存为正式版本并写入 Obsidian，以便长期沉淀。
- Evidence Gate 不通过时不存在 `Save as Final` 入口；V1 无人工强制绕过；
- 提交严格执行 C07 顺序：preflight（draft_revision / record_revision / content_hash / Gate）→ Markdown 冲突确认 → `finalizing` 冻结快照 → 原子 commit point（同一次原子 rename 写入新 `current_final_run_id`、`markdown_sync_status=pending`、`pending_card_path`）→ `finalized` → 原子写 Markdown；
- Markdown 外部修改：比较磁盘 hash 与已记录 hash，仅允许取消 / 明确覆盖 / 另存新文件；实际 rename 前二次比较，消除竞态；
- Markdown 写入失败或二次冲突仅更新 `markdown_sync_status`（error/conflict）并提供重试，不回滚 Current Final；
- 应用永不解析 Markdown 回写 JSON。

**US-10 历史与恢复**
作为用户，我希望重新分析时保留历史版本，并在重启后找回一切。
- 每次 Analyze 创建新 Run；用户主动 Retry 创建带 `retry_of_run_id` 的新 Run；Provider 内部 retry 保持同 Run 并追加 attempts；
- 重新分析不覆盖 Current Final；新 Final 提交后旧 Run 保持 `finalized` 并可在 History 查看（不引入 `superseded` 状态）；
- 启动时残留 `running` 转为 `interrupted`；残留 `finalizing` 按 Current Final 指针恢复（已指向则补为 `finalized`，否则退回 `draft` 并记录 commit error）；
- 重启后 Vault、Library、Reader、Current Final、History、Evidence 回跳与 Markdown 基线全部恢复。

**US-11 非功能需求（全局）**
- 本地服务仅绑定 `127.0.0.1`，限制同源请求，不对局域网开放；
- 所有业务路径在已验证 Vault 内解析，拒绝 `..`、绝对子路径与 symlink escape；
- 持久化 JSON 一律使用同目录临时文件 + flush/fsync + close + 原子 rename，禁止直接覆写；
- 界面与文档语言遵循 UI-COPY-01；按钮提供 Tooltip、选中态与 `aria-label`；Light-only、Desktop-first（V1 Desktop-only）；
- 性能按个人规模评估；实测超出可接受范围时返回 `/plan` 重新决策，不预建数据库。

### 领域合同映射

见第 5 节"领域合同骨架"表；每个故事的验收要点均为 C01–C08 相应条款的产品级表述，实现级细节（字段、转换、写入顺序）以实施计划第 4、5 节为唯一细则。

### 约束与边界情形

- **支持边界**：仅支持可正常提取文本的普通 PDF；扫描件 / 加密 / 超长明确拒绝；2C Spike 已冻结 50 MiB、500 页、600,000 字符和 250,000 estimated tokens 上限，精确值以 `app/src/lib/pdf/pdf-limits.v1.json` 为准；
- **正文前提**：普通单栏/双栏 PDF 必须能形成稳定的逐物理页正文，否则返回 `/plan`（实施计划既定条件）；
- **单用户本地**：无多端同步冲突场景；并发控制聚焦"全局单活动 Analyze Run"与文件原子性；
- **HTTP Provider 边界**：V1 只支持一个 OpenAI-compatible 配置档案、纯文本 Overview 和 Final 后的自由 Chat；不做结构化 Draft/Repair、多个 endpoint/model 档案、按请求传凭据、自动 fallback、向量/远程 RAG 或供应商专属协议；HTTP Chat 每次为独立 task，不支持 resume；
- **删除不可逆**：一次确认永久删除，无废纸篓；确认文本必须列出对象清单。

---

## 8. Dependencies & Risks

### 依赖

| 依赖 | 说明 | 依赖风险 |
|---|---|---|
| Codex CLI | Chat 与结构化分析通道；使用其本机登录态，Lumer 不保存凭据 | 未安装/未登录即明确失败；CLI 输出行为变化需适配 |
| 用户配置的 OpenAI-compatible API | 用于可选论文 Overview 与 Final 后自由 Chat；服务端环境提供一个 base URL/model/API Key 档案 | 兼容实现、鉴权、模型可用性和上下文限制由外部服务决定；失败不得 fallback |
| Obsidian Vault（用户目录） | 全部业务数据的根 | 路径失效/权限变化需进入 Settings 修复 |
| PyMuPDF | 正文提取与 Annotation 写入 | 提取行为差异影响正文基线与证据定位 |
| Annot 快照 `d785f1dd` | 源码起点（仅复制裁剪，运行时零依赖） | 上游缺陷若被复制需在 Lumer 内修复 |
| Node.js 22 生态 / Next.js / Vitest / Playwright | 运行与测试基础设施 | 版本升级兼容性 |
| 用户验收时间 | 每个批次完成后暂停评审 | 批次节奏依赖用户可用性 |

### 风险与缓解

| 风险 | 缓解 |
|---|---|
| CLI/Provider 输出格式变化 | Provider contract tests、prompt/schema 版本化、一次受限 repair、失败保留 Draft |
| OpenAI-compatible 实现差异 | 只依赖 `/models` 与非流式 `/chat/completions` 最小交集；不满足合同即失败，不增加供应商专属分支 |
| API Key/endpoint 泄露 | 只从服务端环境读取；不进入 Settings/API/Vault/Run/日志；远程只允许 HTTPS，禁止跨 origin 携凭据重定向 |
| 论文正文发送到外部服务 | 仅在用户明确选择 HTTP Provider 并发起概览或已有 Final Paper Card 后的 Chat 时发生；UI 预先提示数据边界，健康检查不携带正文 |
| 全文超过模型上下文或参数上限 | Chat 使用本地确定性正文段落选择及版本化总预算；`max_estimated_tokens=250,000` 为应用硬上限，不盲目传输全文，超预算不得越界发送 |
| 模型伪造页码或引文 | 确定性页级 locator；定位失败不得成为 Final |
| Annotation 改变 PDF 二进制 | 身份用持久化 `source_sha256`；证据用忽略 Annotation 的正文 `content_hash` |
| Annotation 内容混入证据 | 提取测试明确排除 Annotation/Memo，并有 invariant 测试 |
| 用户在外部修改 Markdown | `markdown_hash` + 取消/覆盖/另存三分支 + rename 前二次比较 |
| Final commit 过程崩溃或 JSON 半写入 | PaperRecord 同目录 temp + fsync + 原子 rename；`finalizing` 按指针恢复 |
| Markdown 写入失败 | JSON Final 不回滚；记录 pending/error/conflict 并提供重试 |
| Vault 路径越界 | 业务路径一律在已验证 Vault 内解析，拒绝 `..` 与 symlink escape |
| 本地 API 暴露 | 仅绑定 `127.0.0.1`、同源限制 |
| 无数据库扫描变慢 | V1 按个人规模；实测超出可接受范围才返回 `/plan` |
| PRD 与实施计划失同步（文档漂移） | PRD 批准后立即做一致性审计；此后任一文档变更须同时修订两者；合同变更一律返回 `/plan` |
