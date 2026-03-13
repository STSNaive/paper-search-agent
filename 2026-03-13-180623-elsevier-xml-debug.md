## Objective

Ensure Elsevier retrieval yields XML that the system can truthfully treat as full text, and avoid claiming success when the API only returned abstract-level metadata.

## Official Doc Findings

- Source read: https://dev.elsevier.com/use_cases.html
- Source read: https://dev.elsevier.com/guides/ArticleRetrievalViews.htm
- Elsevier's Article Retrieval API supports multiple views including `META`, `META_ABS`, `META_ABS_REF`, and `FULL`.
- The `FULL` view is the one intended for full-text retrieval.
- Access to `FULL` is entitlement-restricted; without sufficient entitlement, responses may degrade to metadata/abstract-level XML instead of article body content.
- This matches the observed old Elsevier cache files: they contain `coredata` and `dc:description`, but no body sections.

## Local Evidence

- `C:\Users\STSna\.codex\mcp\paper-search-agent-mcp\cache\10.1016_j.compstruct.2009.03.001\fulltext.xml`
- `C:\Users\STSna\.codex\mcp\paper-search-agent-mcp\cache\10.1016_j.ultras.2012.08.006\fulltext.xml`
- `C:\Users\STSna\.codex\mcp\paper-search-agent-mcp\cache\10.1016_j.jsv.2008.08.030\fulltext.xml`

Observed pattern:

- XML includes `dc:title`, `dc:description`, publisher metadata, and `originalText` with shallow `xocs:meta`.
- XML does not include `<body>`, `<ce:section>`, or other strong full-text markers.
- The current parser therefore extracts nothing, and the retrieval layer wrongly treats the response as full text just because it is longer than 200 characters.

## Fix Strategy

1. Update Elsevier retrieval requests to explicitly request `view=FULL`.
2. Detect whether an Elsevier XML response actually contains full-text markers before treating it as success.
3. If response is abstract-only, return a clear error so the planner can fall back instead of pretending the LLM read the paper.
4. Improve XML parsing fallback so abstract-level Elsevier XML still yields a readable abstract when users intentionally inspect it.

## Verification Plan

- Build the MCP package after edits.
- Re-parse real cached Elsevier XML samples and confirm:
  - abstract-only XML yields readable abstract text
  - true full-text XML still parses successfully
- Confirm retrieval no longer classifies abstract-only Elsevier XML as full text.

## Changes Made

- Updated `mcp/paper-search-agent-mcp/src/adapters/publishers/elsevier.ts`
  - explicit `view=FULL` on Article Retrieval API requests
  - full-text marker detection for Elsevier XML
  - abstract-only XML is now rejected as a successful full-text fetch
- Updated `mcp/paper-search-agent-mcp/src/adapters/parsing/paper-parser.ts`
  - abstract fallback from `dc:description`
  - author fallback from `dc:creator`
  - fallback extraction from `originalText` when useful
- Added `mcp/paper-search-agent-mcp/tests/elsevier.test.ts`

## Verification Results

- `npm run build` succeeded in `d:\Users\STSna\Projects\paper-search-agent\mcp\paper-search-agent-mcp`
- Manual re-parse using built code against real cache files:
  - `10.1016/j.compstruct.2009.03.001` -> text length `1022`, section `abstract`
  - `10.1016/j.ultras.2012.08.006` -> text length `651`, section `abstract`
  - `10.1016/j.jsv.2008.08.030` -> text length `1365`, section `abstract`
  - `10.1016/j.jmp.2024.102843` -> text length `48740`, `14` sections
- `vitest` did not run in this sandbox because Vite config startup hit `spawn EPERM`; build-based/manual verification was used instead.
