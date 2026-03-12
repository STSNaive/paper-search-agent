# paper-search-agent

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

- Node.js ≥ 20
- npm or pnpm
- A campus network (for subscription full-text routes) or VPN/EZproxy
- API keys as needed (see `.env.example`)

## Installation and Usage

### Option A: Use in Codex with local source build (recommended)

This mode matches the real project architecture: root `AGENTS.md` + `skills/` + local MCP server.

```bash
# 1. Clone
git clone https://github.com/STSNana/paper-search-agent.git
cd paper-search-agent

# 2. Environment
# Linux/macOS:
cp .env.example .env
# Windows PowerShell:
# Copy-Item .env.example .env

# 3. Build MCP server
cd mcp/paper-search-agent-mcp
npm install
npm run build
cd ../..
```

Configure Codex MCP (for example in your Codex MCP config):

```json
{
  "mcpServers": {
    "paper-search-agent": {
      "command": "node",
      "args": ["mcp/paper-search-agent-mcp/dist/server.js"],
      "cwd": "."
    }
  }
}
```

Then create your runtime config (copy from example and edit):

```bash
# Linux/macOS:
cp mcp/paper-search-agent-mcp/config.toml.example mcp/paper-search-agent-mcp/config.toml
# Windows PowerShell:
# Copy-Item mcp/paper-search-agent-mcp/config.toml.example mcp/paper-search-agent-mcp/config.toml
```

### Option B: Install MCP server package via npm

Repository name and npm package name are different:

- Repository: `paper-search-agent`
- npm package (MCP server): `paper-search-agent-mcp`

```bash
npm install -g paper-search-agent-mcp
```

MCP config example:

```json
{
  "mcpServers": {
    "paper-search-agent": {
      "command": "paper-search-agent-mcp"
    }
  }
}
```

Note: npm package mode installs the MCP server binary. The root workspace resources (`AGENTS.md`, `skills/`) are part of this repository workflow.

### Claude Code Users

```bash
./scripts/setup-claude.sh   # or .\scripts\setup-claude.ps1 on Windows
# Generates CLAUDE.md and .mcp.json — then use Claude Code normally
```

## Project Structure

```
paper-search-agent/
├── AGENTS.md              # Codex root agent instructions (single agent)
├── design-plan.md         # Full architecture and rationale
├── .env.example           # API key template
├── skills/                # Domain knowledge (Agent Skills standard)
├── mcp/                   # MCP server (Node.js + TypeScript)
├── schemas/               # Shared schema documentation
├── scripts/               # Compatibility & utility scripts
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

## Design

See [design-plan.md](design-plan.md) for the full architecture and rationale.

## License

MIT
