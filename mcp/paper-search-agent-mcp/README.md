# paper-search-agent-mcp

An MCP (Model Context Protocol) server that provides AI coding assistants with scholarly paper discovery, access planning, and full-text retrieval capabilities.

This package is the installable MCP server for the `paper-search-agent` repository.

## Install

```bash
npm install -g paper-search-agent-mcp
```

Or run directly with npx:

```bash
npx paper-search-agent-mcp
```

## Configuration

### MCP Client Setup

For Codex CLI / Codex IDE, configure MCP in `.codex/config.toml` (project-scoped) or `~/.codex/config.toml`:

```toml
[mcp_servers.paper_search_agent]
command = "paper-search-agent-mcp"
```

Or add it via CLI:

```bash
codex mcp add paper_search_agent -- paper-search-agent-mcp
```

For other clients that use JSON-based MCP config, use:

Add the server to your AI assistant's MCP configuration:

```json
{
  "mcpServers": {
    "paper-search-agent": {
      "command": "paper-search-agent-mcp"
    }
  }
}
```

### config.toml

Create a `config.toml` in your working directory to enable/disable sources and routes. Copy from the bundled example:

```bash
cp $(npm root -g)/paper-search-agent-mcp/config.toml.example config.toml
```

### Environment Variables

Set API keys as environment variables or in a `.env` file in your working directory:

| Variable | Required | Description |
|---|---|---|
| `ELSEVIER_API_KEY` | For Scopus/Elsevier | dev.elsevier.com |
| `SPRINGER_API_KEY` | For Springer Meta | dev.springernature.com |
| `SPRINGER_OA_API_KEY` | For Springer OA | May share key with SPRINGER_API_KEY |
| `UNPAYWALL_EMAIL` | For Unpaywall | A valid email address |
| `NCBI_API_KEY` | Optional | Raises PubMed rate limit |
| `ZOTERO_API_KEY` | For Zotero | zotero.org/settings/keys |
| `ZOTERO_LIBRARY_ID` | For Zotero | Your library ID |

## Available Tools

- **Discovery**: `search_papers`, `search_single_source` — multi-source academic search
- **Planning**: `resolve_and_plan`, `check_local_cache` — DOI resolution and access planning
- **Retrieval**: `fetch_fulltext`, `browser_retrieve`, `import_local_file` — full-text acquisition
- **Parsing**: `parse_paper`, `get_paper_sections` — structured content extraction
- **Storage**: `manage_corpus`, `export_records` — corpus management and export
- **Integrations**: `zotero_lookup`, `zotero_save`, `zotero_list_collections` — Zotero library

## License

MIT
