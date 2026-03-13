# paper-search-agent

[English](README.md) | [中文](README.zh-CN.md)

A local-first scholarly paper discovery, access planning, and full-text retrieval agent.

## Capabilities

### Discovery and triage

- Multi-source search with automatic de-duplication via `search_papers`.
- Single-source deep search via `search_single_source`.
- Enabled discovery sources in current codebase:
  - OpenAlex
  - Crossref
  - Scopus
  - Springer Meta
  - arXiv
  - PubMed
  - Europe PMC
  - Unpaywall

### Access planning

- DOI/paper resolution and route planning via `resolve_and_plan`.
- Local cache checks via `check_local_cache`.
- Route preference order: local cache -> Zotero -> OA -> publisher APIs -> browser-assisted -> manual import.

### Full-text retrieval

- Unified retrieval execution via `fetch_fulltext`.
- Human-in-the-loop browser retrieval via `browser_retrieve`.
- Local file ingestion via `import_local_file`.

### Parsing and selective reading

- Artifact parsing (`xml`, `html`, `pdf`, `text`) via `parse_paper`.
- Section-level extraction via `get_paper_sections`.
- Soft token-budget advisory (no hard truncation).

### Corpus and exports

- Corpus management via `manage_corpus` (`add`, `list`, `remove`, `deduplicate`).
- Export in `json`, `csv`, `bibtex` via `export_records`.

### Optional integration

- Zotero tools (when enabled): `zotero_lookup`, `zotero_save`, `zotero_list_collections`.

## Workflow

The practical pipeline is:

1. Discover papers (`search_papers` / `search_single_source`) -> produce `CandidatePaper[]`.
2. Plan access (`resolve_and_plan`) -> produce `AccessPlan`.
3. Retrieve artifact (`fetch_fulltext` / `browser_retrieve` / `import_local_file`) -> store local PDF/XML/HTML/text.
4. Parse content (`parse_paper`) -> produce `NormalizedPaperRecord`.
5. Read targeted sections (`get_paper_sections`) and optionally save/export (`manage_corpus`, `export_records`).

This separation is intentional: discovery does not imply full-text entitlement.

## Prerequisites

- [OpenAI Codex CLI](https://github.com/openai/codex) (`npm install -g @openai/codex`)
- Node.js ≥ 20
- npm
- A campus network (for subscription full-text routes) or VPN/EZproxy
- API keys as needed (see `.env.example`)

## Installation and Usage

### Option A: Use in Codex with local source build (recommended)

This mode matches the real project architecture: root `AGENTS.md` + `skills/` + local MCP server.

Linux/macOS:

```bash
# 1. Clone and enter project
git clone https://github.com/STSNaive/paper-search-agent.git
cd paper-search-agent

# 2. Build MCP server
cd mcp/paper-search-agent-mcp
npm install
npm run build

# 3. Environment — set your API keys
cp ../../.env.example .env
# Edit .env and fill in your API keys

# 4. Runtime config (optional — defaults are used if missing)
cp config.toml.example config.toml
# Edit config.toml to enable/disable sources and routes

cd ../..
```

Windows PowerShell:

```powershell
# 1. Clone and enter project
git clone https://github.com/STSNaive/paper-search-agent.git
cd paper-search-agent

# 2. Build MCP server
cd mcp\paper-search-agent-mcp
npm install
npm run build

# 3. Environment — set your API keys
Copy-Item ..\..\.env.example .env
# Edit .env and fill in your API keys

# 4. Runtime config (optional — defaults are used if missing)
Copy-Item config.toml.example config.toml
# Edit config.toml to enable/disable sources and routes

cd ..\..
```

Register the MCP server with Codex. Choose **one** of the following methods:

**Method 1 — Manual config file** (recommended for full control):

Add to `.codex/config.toml` (project-scoped) or `~/.codex/config.toml` (global):

```toml
[mcp_servers.paper_search_agent]
command = "node"
args = ["dist/server.js"]
cwd = "mcp/paper-search-agent-mcp"
```

**Method 2 — Codex CLI command**:

```bash
codex mcp add paper_search_agent -- node mcp/paper-search-agent-mcp/dist/server.js
```

> **Note**: When using `codex mcp add`, the MCP server's working directory defaults to the project root. The server will look for `.env` and `config.toml` in its working directory first, then fall back to `../../config.toml`. If you placed `.env` inside `mcp/paper-search-agent-mcp/`, use Method 1 with explicit `cwd` instead.

After registration, start Codex in the project directory:

```bash
codex
```

Codex will automatically read `AGENTS.md` for agent instructions and `skills/` for domain knowledge.

If you use the Codex IDE extension, it reads the same Codex config file.

### Option B: Install MCP server package via npm

Repository name and npm package name are different:

- Repository: `paper-search-agent`
- npm package (MCP server): `paper-search-agent-mcp`

```bash
npm install -g paper-search-agent-mcp
```

Register with Codex:

```toml
[mcp_servers.paper_search_agent]
command = "paper-search-agent-mcp"
```

Or via CLI:

```bash
codex mcp add paper_search_agent -- paper-search-agent-mcp
```

Note: npm package mode installs the MCP server binary only. Clone this repository to get the root workspace resources (`AGENTS.md`, `skills/`).

### Claude Code Users

```bash
./scripts/setup-claude.sh   # or .\scripts\setup-claude.ps1 on Windows
# Generates CLAUDE.md and .mcp.json — then use Claude Code normally
```

## Testing

Run tests from `mcp/paper-search-agent-mcp`:

- `npm test` runs the default deterministic suite. Live network/provider smoke tests are skipped by default.
- `npm run test:live` runs the live integration suite against real external providers and automatically enables `RUN_LIVE_API_TESTS=1`.
- `npm run test:live -- --reporter=verbose tests/comprehensive.test.ts` is useful when you want to rerun a specific live test file while debugging a flaky provider.

Live tests depend on network reachability, API keys, third-party service health, and the current machine environment, so transient timeouts or rate limits are possible.
## Project Structure

```
paper-search-agent/
├── AGENTS.md              # Codex root agent instructions (single agent)
├── ARCHITECTURE.md        # System architecture overview
├── .env.example           # API key template
├── skills/                # Domain knowledge (Agent Skills standard)
├── mcp/                   # MCP server (Node.js + TypeScript)
├── scripts/               # Compatibility & utility scripts
├── docs/                  # Archived design docs (git-ignored)
├── cache/                 # Local cache (git-ignored)
├── corpus/                # Paper corpus (git-ignored)
└── artifacts/             # Downloaded artifacts (git-ignored)
```

## Configuration

For source-build mode, switches live in `mcp/paper-search-agent-mcp/config.toml`. If missing, defaults are used from code.

Key sections:

- `[discovery]` — toggle each discovery source
- `[retrieval]` — toggle each retrieval route
- `[integrations]` — optional Zotero integration
- `[browser]` — browser state management
- `[token_budget]` — LLM context management

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system design overview.

## License

MIT
