# Schemas

This directory documents the shared data schemas used by paper-search-agent.

The canonical TypeScript definitions live in `mcp/paper-search-agent-mcp/src/schemas/`.

## Core Schemas

| Schema | File | Purpose |
|---|---|---|
| `CandidatePaper` | `candidate-paper.ts` | A discovered paper with metadata and OA hints |
| `DiscoveryResult` | `candidate-paper.ts` | Aggregated output from discovery sources |
| `AccessPlan` | `access-plan.ts` | Retrieval strategy with routes and fallbacks |
| `AccessAttempt` | `access-plan.ts` | Record of a single retrieval attempt |
| `NormalizedPaperRecord` | `normalized-paper.ts` | Structured paper content for LLM consumption |
| `TopicCorpusItem` | `normalized-paper.ts` | Entry in a topic-scoped paper corpus |

## Route Types

Defined in `access-plan.ts`:

- `local_cache` — already stored locally
- `zotero_existing` — found in user's Zotero library
- `oa_openalex` — OpenAlex OA download
- `oa_unpaywall` — Unpaywall OA download
- `oa_publisher` — publisher's own OA route
- `europe_pmc_fulltext` — Europe PMC free XML
- `elsevier_api_fulltext` — Elsevier API (campus-entitled)
- `springer_oa_api` — Springer OpenAccess API (OA only)
- `wiley_tdm_download` — Wiley TDM by DOI
- `browser_download_pdf` — browser-assisted PDF download
- `browser_capture_html` — browser-assisted HTML capture
- `manual_import_pdf` — user-provided file
