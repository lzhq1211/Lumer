# Lumer Assistant 使用说明

Lumer 用于阅读 PDF、做标注、生成论文概览，并围绕已保存的论文卡片继续提问。论文文件、标注、分析记录和对话保存在你指定的本地目录中，论文卡片以 Markdown 写入该目录，可在 Obsidian 中打开。

本文介绍安装、使用方法和代码结构。项目展示见仓库根目录的 README。

## 安装与启动

准备以下环境：

- Node.js 20.9.0 或更高版本，以及 npm。
- Python 3.10 或更高版本。
- 使用 Codex 时，需在本机安装 Codex CLI 并完成登录；使用自定义 API 时，在 Lumer 的设置页填写连接信息。

Python 和 PyMuPDF 没有打包进仓库。下面的命令会创建项目专用的 Python 环境，并按 `python/requirements.txt` 安装 PyMuPDF。

### macOS / Linux

在仓库根目录打开终端，执行：

```bash
cd app
python3 -m venv .venv
.venv/bin/python -m pip install -r python/requirements.txt
npm ci
npm run build
npm run start
```

也可以在仓库根目录用一条命令完成安装和构建：

```bash
cd app && python3 -m venv .venv && .venv/bin/python -m pip install -r python/requirements.txt && npm ci && npm run build
```

完成后，在 `app/` 目录执行 `npm run start`，打开 <http://127.0.0.1:3000>。

macOS 用户完成首次安装后，也可以双击仓库根目录的 `Lumer Assistant.app`。它依赖同级 `app/` 目录，不能单独移走。启动器会在缺少生产构建时执行构建，但不会安装 Node 或 Python 依赖。关闭所有 Lumer 页面后，由启动器启动的服务会自动退出；终端手动启动的服务用 `Ctrl+C` 停止。

### Windows PowerShell

在仓库根目录执行以下命令。每一步成功后再执行下一步：

```powershell
cd app
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r python/requirements.txt
npm ci
npm run build
npm run start
```

打开 <http://127.0.0.1:3000>。Windows 使用命令行启动，仓库中的 `.app` 仅供 macOS 使用。

Lumer 会自动查找 `app/.venv`，无需手动激活虚拟环境。如果显式设置了 `LUMER_PYTHON_BIN`，则优先使用指定的 Python。

更新源码或依赖后，在 `app/` 目录重新安装依赖并执行 `npm run build`，再重启服务。

## 首次配置

### 选择数据目录

先创建一个可读写的目录，或选择已有的 Obsidian Vault。在 Lumer 的 Settings 中填写该目录的绝对路径，点击“验证路径”或“保存设置”。普通目录也能使用，不要求安装 Obsidian。

切换 Vault 会切换当前文献库，不会自动迁移旧目录的数据。切回原路径即可读取原来的记录。

### 连接 AI 服务

Lumer 当前提供 Codex CLI 和 OpenAI-compatible API 两种接入方式。

- **Codex CLI**：复用本机 CLI 的登录状态。登录后，在 Settings 点击“刷新状态”。
- **自定义 API**：填写服务名称、API URL、模型名称和服务所需的 API Key，点击“保存 API 配置”，再刷新 Provider 状态。API URL 需包含 `/v1` 路径，远程服务使用 HTTPS，本机回环地址可以使用 HTTP。服务需提供 `/models` 和 `/chat/completions` 接口。

Provider 可用后，分别选择默认自由对话和论文分析 Provider，再保存设置。Claude Code 当前显示为“未接入”。

Codex 登录信息由 CLI 管理。自定义 API 配置保存在本机的 `~/.lumer/config.json`，不写入论文所在的 Vault。也可以通过 `app/.env.local` 提供以下环境变量作为回退配置；Settings 中已保存的 API 配置优先：

```dotenv
LUMER_OPENAI_COMPAT_BASE_URL=https://api.example.com/v1
LUMER_OPENAI_COMPAT_MODEL=your-model-id
LUMER_OPENAI_COMPAT_API_KEY=
```

将示例地址和模型替换成自己的服务信息。环境变量修改后需要重启服务。

## 使用流程

### 导入与阅读

在文献库导入 PDF，打开论文进入阅读器。Lumer 会将 PDF 复制到 Vault 的 `Papers/` 中；后续高亮和批注写入这份托管副本，导入前的源文件保持原样。

阅读器支持翻页、文字选择、高亮和批注。文献库按论文管理，提供检索、标签筛选和元数据编辑。

### 生成概览与论文卡片

在阅读器中发起概览，Lumer 将提取的论文正文发送给所选 Provider，并在分析页展示返回内容。检查结果后，点击“同步到 Obsidian”，将概览保存为 Final，并生成 Vault 中的 Markdown 论文卡片。

当前日常入口生成的是论文概览。概览保存为 Final 表示你选择将其作为当前版本，并不表示内容已经过逐条证据核验。

系统也保留结构化 Paper Card 的 Draft、编辑和 Evidence 验证流程。这类卡片需要通过 Evidence Gate 才能保存为 Final；验证检查引文能否在当前 PDF 的对应页定位，结论是否得到引文支持仍需你判断。

Final 保存后保持只读。后续修改通过新草稿或重新生成完成，旧版本保留在分析记录中。如果你在 Obsidian 中改过 Markdown，同步时可能出现冲突，可按页面提示处理冲突或另存。

### 围绕论文提问

论文有了当前 Final Paper Card 后，阅读器中的 Chat 才会开放。对话使用当前论文正文和最终卡片作为上下文，可用于解释段落、讨论方法和继续追问。

对话记录按论文和 Provider 区分。每次概览或 Retry 都创建新的 Provider 任务，不复用之前的自由对话。Provider 不可用时，Lumer 会显示失败原因，不会自动切换到另一家服务。

## 数据存放位置

机器级配置默认位于用户主目录的 `.lumer/config.json`。论文业务数据保存在 Settings 中选择的 Vault：

```text
Vault/
├── Papers/             # 托管 PDF，包含写入的高亮和批注
├── Paper Cards/        # 导出的 Markdown 论文卡片
└── .lumer/
    ├── papers/         # 论文元数据和当前 Final 指针
    ├── extractions/    # 提取的正文与页码定位信息
    ├── analyses/       # 草稿、概览、Final 和历史运行记录
    ├── sessions/       # 论文对话记录
    ├── operations/     # 导入和标注操作的恢复记录
    └── runtime.lock    # Vault 进程锁
```

备份时保留整个 Vault，包括隐藏的 `.lumer/` 目录。单独备份 Markdown 不包含完整的分析与对话记录。

本地服务默认只监听 `127.0.0.1`。调用 AI 时，相关论文正文和对话上下文会发送给你配置的 Provider。文献库动态背景还会访问 Mux，并在需要时从 jsDelivr 加载播放器；加载失败时回退到仓库内的静态背景。

## 架构与目录

浏览器负责文献库、PDF 阅读和结果展示；Next.js API 接收请求，由应用服务协调 PDF worker、AI Provider 和本地文件存储。

| 模块 | 位置 | 职责 |
|---|---|---|
| 页面与 API | `src/app/` | Next.js 页面、HTTP 路由和 SSE 响应 |
| 界面组件 | `src/components/` | 文献库、阅读器、分析页与设置页 |
| 应用服务 | `src/application/` | 导入、标注、分析、Final、对话及异常恢复 |
| 领域模型 | `src/domain/` | 论文、分析运行和对话的数据结构与状态规则 |
| AI 接入 | `src/lib/ai-providers/` | Codex CLI 和 OpenAI-compatible HTTP 适配 |
| 配置与存储 | `src/lib/config/`、`src/lib/storage/` | 本机配置、Vault 路径、JSON 持久化和文件锁 |
| PDF 处理 | `src/lib/pdf/`、`python/` | 调用 Python/PyMuPDF 提取正文、检查 PDF 和写入标注 |
| 证据与导出 | `src/lib/evidence/`、`src/lib/markdown/` | 引文定位与 Paper Card Markdown 渲染 |
| 静态资源 | `public/` | Logo、背景和浏览器 PDF worker |
| 自动验证 | `src/**/*.test.*`、`tests/` | 单元、集成和端到端测试 |

PDF 在浏览器中通过 react-pdf / PDF.js 渲染，正文提取和标注写入由 Python/PyMuPDF 完成。Markdown 使用 React Markdown 展示，数学公式由 KaTeX 渲染。

服务端将正式数据保存为 JSON，并通过临时文件和原子替换写入。Final 提交后再生成 Markdown；Markdown 同步失败时保留已提交的 Final，可在页面中重试。同一个 Vault 由一个 Lumer 进程持有，同时只允许一个分析或 Final 提交任务处于活动状态。

## 开发与排查

以下命令在 `app/` 目录执行：

```bash
npm run dev               # 开发服务
npm run typecheck         # TypeScript 检查
npm run lint              # ESLint
npm test                  # 单元测试
npm run test:integration  # 集成测试
npm run test:e2e          # Playwright 端到端测试
```

| 问题 | 处理方法 |
|---|---|
| 找不到 Python 或提示缺少 `pymupdf` | 确认 Python 版本，使用 `app/.venv` 中的 Python 重新安装 `python/requirements.txt`，然后重启 Lumer |
| 双击启动器失败 | 先在终端完成安装和构建，查看仓库根目录 `.lumer-launcher/server.log`；使用 nvm 等工具安装 Node 时，可先从终端运行 `npm run start` |
| Vault 不可用 | 确认目录存在、可读写，并未被另一个 Lumer 进程占用 |
| Provider 不可用 | 检查 CLI 登录或 API 配置，再刷新状态 |
| Chat 尚未开放 | 先生成概览并同步为 Final，或完成结构化 Paper Card 的验证和 Final 保存 |
| 更新后仍显示旧界面 | 在 `app/` 执行 `npm run build`，停止旧服务后重新启动 |
