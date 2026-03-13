import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "../config.js";

import { handleSearchPapers, handleSearchSingleSource } from "./handlers/discovery.js";
import { handleResolveAndPlan, handleCheckLocalCache } from "./handlers/planning.js";
import { handleFetchFulltext, handleImportLocalFile, handleBrowserRetrieve } from "./handlers/retrieval.js";
import { handleParsePaper, handleGetPaperSections } from "./handlers/parsing.js";
import { handleManageCorpus, handleExportRecords } from "./handlers/storage.js";
import { handleZoteroLookup, handleZoteroSave, handleZoteroListCollections } from "./handlers/zotero.js";

function err(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

/**
 * Dispatch an incoming tool call to the appropriate handler.
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  switch (name) {
    // ── Discovery Tools ──
    case "search_papers":
      return handleSearchPapers(args, config);
    case "search_single_source":
      return handleSearchSingleSource(args, config);

    // ── Planning Tools ──
    case "resolve_and_plan":
      return handleResolveAndPlan(args, config);
    case "check_local_cache":
      return handleCheckLocalCache(args, config);

    // ── Retrieval Tools ──
    case "fetch_fulltext":
      return handleFetchFulltext(args, config);
    case "import_local_file":
      return handleImportLocalFile(args, config);
    case "browser_retrieve":
      if (!config.retrieval.browser_assisted) {
        return err("browser_assisted route is disabled in config.toml");
      }
      return handleBrowserRetrieve(args, config);

    // ── Parsing Tools ──
    case "parse_paper":
      return handleParsePaper(args, config);
    case "get_paper_sections":
      return handleGetPaperSections(args, config);

    // ── Storage Tools ──
    case "manage_corpus":
      return handleManageCorpus(args, config);
    case "export_records":
      return handleExportRecords(args, config);

    // ── Zotero Tools ──
    case "zotero_lookup":
      return handleZoteroLookup(args, config);
    case "zotero_save":
      return handleZoteroSave(args, config);
    case "zotero_list_collections":
      return handleZoteroListCollections(args, config);

    default:
      return err(`Unknown tool: ${name}`);
  }
}
