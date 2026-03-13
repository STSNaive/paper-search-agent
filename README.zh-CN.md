# paper-search-agent

[English](README.md) | [中文](README.zh-CN.md)

一个本地优先的学术论文发现、访问规划和全文检索 Agent。

## 功能

### 发现与筛选

- 通过 `search_papers` 进行多源搜索并自动去重。
- 通过 `search_single_source` 对单一数据源进行深度搜索。
- 当前代码库中已实现的数据源：
  - OpenAlex
  - Crossref
  - Scopus
  - Springer Meta
  - arXiv
  - PubMed
  - Europe PMC
  - Unpaywall

### 访问规划

- 通过 `resolve_and_plan` 进行 DOI / 论文解析和路由规划。
- 通过 `check_local_cache` 检查本地缓存。
- 路由优先级：本地缓存 -> Zotero -> OA -> 出版商 API -> 浏览器辅助 -> 手动导入。

### 全文检索

- 通过 `fetch_fulltext` 执行统一的检索流程。
- 通过 `browser_retrieve` 进行人机协同的浏览器检索。
- 通过 `import_local_file` 导入本地文件。

### 解析与选读

- 通过 `parse_paper` 解析多种格式（`xml`、`html`、`pdf`、`text`）。
- 通过 `get_paper_sections` 进行章节级提取。
- 软 token 预算建议（不做硬截断）。

### 语料库与导出

- 通过 `manage_corpus`（`add`、`list`、`remove`、`deduplicate`）管理语料库。
- 通过 `export_records` 导出为 `json`、`csv`、`bibtex` 格式。

### 可选集成

- Zotero 工具（启用后可用）：`zotero_lookup`、`zotero_save`、`zotero_list_collections`。

## 工作流程

实际流水线：

1. 发现论文（`search_papers` / `search_single_source`）-> 输出 `CandidatePaper[]`。
2. 规划访问（`resolve_and_plan`）-> 输出 `AccessPlan`。
3. 检索全文（`fetch_fulltext` / `browser_retrieve` / `import_local_file`）-> 存储本地 PDF/XML/HTML/text。
4. 解析内容（`parse_paper`）-> 输出 `NormalizedPaperRecord`。
5. 读取目标章节（`get_paper_sections`）并可选保存/导出（`manage_corpus`、`export_records`）。

此分离是有意为之：发现论文并不意味着有权获取全文。

## 前置要求

- [OpenAI Codex CLI](https://github.com/openai/codex)（`npm install -g @openai/codex`）
- Node.js ≥ 20
- npm
- 校园网络（用于订阅内容的全文检索路由）或 VPN/EZproxy
- 所需的 API 密钥（参见 `.env.example`）

## 安装与使用

### 方式 A：在 Codex 中使用本地源码构建（推荐）

此方式与项目实际架构一致：根目录 `AGENTS.md` + `skills/` + 本地 MCP 服务器。

Linux/macOS：

```bash
# 1. 克隆并进入项目
git clone https://github.com/STSNaive/paper-search-agent.git
cd paper-search-agent

# 2. 构建 MCP 服务器
cd mcp/paper-search-agent-mcp
npm install
npm run build

# 3. 环境变量 — 设置 API 密钥
cp ../../.env.example .env
# 编辑 .env，填入你的 API 密钥

# 4. 运行时配置（可选 — 缺失时使用默认值）
cp config.toml.example config.toml
# 编辑 config.toml 启用/禁用数据源和检索路由

cd ../..
```

Windows PowerShell：

```powershell
# 1. 克隆并进入项目
git clone https://github.com/STSNaive/paper-search-agent.git
cd paper-search-agent

# 2. 构建 MCP 服务器
cd mcp\paper-search-agent-mcp
npm install
npm run build

# 3. 环境变量 — 设置 API 密钥
Copy-Item ..\..\.env.example .env
# 编辑 .env，填入你的 API 密钥

# 4. 运行时配置（可选 — 缺失时使用默认值）
Copy-Item config.toml.example config.toml
# 编辑 config.toml 启用/禁用数据源和检索路由

cd ..\..
```

将 MCP 服务器注册到 Codex。选择以下方法之**一**：

**方法 1 — 手动编辑配置文件**（推荐，控制更精确）：

添加到 `.codex/config.toml`（项目级）或 `~/.codex/config.toml`（全局）：

```toml
[mcp_servers.paper_search_agent]
command = "node"
args = ["dist/server.js"]
cwd = "mcp/paper-search-agent-mcp"
```

**方法 2 — Codex CLI 命令**：

```bash
codex mcp add paper_search_agent -- node mcp/paper-search-agent-mcp/dist/server.js
```

> **注意**：使用 `codex mcp add` 时，MCP 服务器的工作目录默认为项目根目录。服务器会先在工作目录中查找 `.env` 和 `config.toml`，找不到时再回退到 `../../config.toml`。如果你将 `.env` 放在了 `mcp/paper-search-agent-mcp/` 内，请使用方法 1 并明确指定 `cwd`。

注册完成后，在项目目录中启动 Codex：

```bash
codex
```

Codex 会自动读取 `AGENTS.md` 作为 Agent 指令，`skills/` 作为领域知识。

如果使用 Codex IDE 扩展，它读取的是同一个 Codex 配置文件。

### 方式 B：通过 npm 安装 MCP 服务器包

仓库名和 npm 包名不同：

- 仓库：`paper-search-agent`
- npm 包（MCP 服务器）：`paper-search-agent-mcp`

```bash
npm install -g paper-search-agent-mcp
```

注册到 Codex：

```toml
[mcp_servers.paper_search_agent]
command = "paper-search-agent-mcp"
```

或通过 CLI：

```bash
codex mcp add paper_search_agent -- paper-search-agent-mcp
```

注意：npm 包模式仅安装 MCP 服务器。若需根目录工作区资源（`AGENTS.md`、`skills/`），需克隆此仓库。

### Claude Code 用户

```bash
./scripts/setup-claude.sh   # Windows 下使用 .\scripts\setup-claude.ps1
# 生成 CLAUDE.md 和 .mcp.json — 然后正常使用 Claude Code
```

## 项目结构

```
paper-search-agent/
├── AGENTS.md              # Codex 根 Agent 指令（单 Agent 架构）
├── ARCHITECTURE.md        # 系统架构概览
├── .env.example           # API 密钥模板
├── skills/                # 领域知识（Agent Skills 标准）
├── mcp/                   # MCP 服务器（Node.js + TypeScript）
├── scripts/               # 兼容性与工具脚本
├── docs/                  # 归档设计文档（不上传到 git）
├── cache/                 # 本地缓存（不上传到 git）
├── corpus/                # 论文语料库（不上传到 git）
└── artifacts/             # 下载的文件（不上传到 git）
```

## 配置

源码构建模式下，配置开关位于 `mcp/paper-search-agent-mcp/config.toml`。缺失时使用代码中的默认值。

主要配置节：

- `[discovery]` — 切换各数据源的启用/禁用
- `[retrieval]` — 切换各检索路由的启用/禁用
- `[integrations]` — 可选 Zotero 集成
- `[browser]` — 浏览器状态管理
- `[token_budget]` — LLM 上下文管理

## 架构

详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 许可证

MIT
