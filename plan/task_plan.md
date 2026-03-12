# Task Plan

This file tracks the current implementation status of paper-search-agent.

## Phase 0 — Design and Scaffold ✅

- [x] Project directory structure
- [x] `design-plan.md`
- [x] `config.toml` with all source switches
- [x] `.env.example`
- [x] `.gitignore`
- [x] `AGENTS.md` (root + agents)
- [x] Skill definitions (topic-scoping, access-routing, fulltext-ingestion)
- [x] MCP server scaffold (package.json, tsconfig, server.ts)
- [x] Schema drafts (CandidatePaper, AccessPlan, NormalizedPaperRecord)
- [x] Claude compatibility scripts (setup-claude.sh, setup-claude.ps1)

## Phase 1 — Core Discovery and Access Planner ✅

- [x] OpenAlex discovery adapter (search + per-DOI OA lookup)
- [x] Crossref discovery adapter (search + DOI resolution + publisher inference)
- [x] Unpaywall OA location adapter (per-DOI lookup)
- [x] Access planner (8-step routing logic, entitlement assessment, fallback chains)
- [x] Local cache with DOI-safe paths and metadata
- [x] Corpus management (add, list, remove, deduplicate)
- [x] De-duplication utility for cross-source candidates
- [x] `search_papers` tool — multi-source parallel search with dedup
- [x] `search_single_source` tool — per-source search
- [x] `resolve_and_plan` tool — DOI → AccessPlan
- [x] `check_local_cache` tool
- [x] `manage_corpus` tool (add/list/remove/deduplicate)
- [x] End-to-end verification: tools/list, OpenAlex search, Crossref search, multi-source search, access planning

### Next: Phase 2 — OA and Local Storage Loop ✅
- [x] `fetch_fulltext` (OA routes: OpenAlex, Unpaywall, Europe PMC)
- [x] `import_local_file`
- [x] `parse_paper` (XML and plain text; PDF via Anthropic PDF skill)
- [x] Europe PMC discovery + fulltext adapter
- [x] `get_paper_sections` (selective section extraction, disk-persisted)
- [x] `export_records` (JSON, CSV, BibTeX)
- [x] Format priority: structured text (XML) preferred over PDF for LLM efficiency

### Phase 3 — Elsevier Adapter ✅
- [x] Elsevier preflight (entitlement check)
- [x] Elsevier Article Retrieval API (XML first, text fallback)
- [x] Entitlement diagnostics (401/403/404/429 handling)
- [ ] **Test with real API key** (user offered key, pending)

### Phase 4 — Browser Route and Springer/Wiley ✅
- [x] `browser_retrieve` with human-in-the-loop (Playwright + Chromium)
- [x] Browser state saving/restoration (cookies/storage)
- [x] Challenge detection (CAPTCHA, login, Cloudflare, cookie consent, paywall)
- [x] PDF download + HTML capture from publisher pages
- [x] Springer OA API adapter (JATS XML via OpenAccess API)
- [x] Wired into `fetch_fulltext` route execution
- [x] Audit logging for all retrieval attempts (JSONL)
- [ ] Wiley TDM adapter (optional, requires WILEY_TDM_TOKEN)

### Phase 5 — Integrations and Hardening
- [ ] Zotero integration (lookup + save)
- [ ] Additional discovery sources (Scopus, Semantic Scholar, arXiv, PubMed)
- [x] Audit logs (JSONL append-only)
- [ ] Export restrictions
- [ ] EZproxy/CARSI support (optional)
