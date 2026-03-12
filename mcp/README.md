# MCP Server

This directory contains the MCP (Model Context Protocol) server for `paper-search-agent`.

## Structure

```
paper-search-agent-mcp/
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts          # MCP server entry point
    ├── config.ts          # Reads config.toml and exposes switches
    ├── tools/             # Tool registration and dispatch
    ├── adapters/          # External service adapters
    │   ├── discovery/     # OpenAlex, Crossref, Scopus, etc.
    │   ├── publishers/    # Elsevier, Springer, Wiley, Europe PMC
    │   ├── browser/       # Playwright browser automation
    │   └── storage/       # Local cache and corpus
    ├── planners/          # Access planning logic
    ├── schemas/           # TypeScript interface definitions
    └── utils/             # Shared utilities
```

## Development

```bash
cd mcp/paper-search-agent-mcp
npm install
npm run build
npm run dev    # watch mode
```
