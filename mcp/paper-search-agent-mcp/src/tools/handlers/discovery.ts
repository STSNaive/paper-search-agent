import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "../../config.js";
import { searchConcurrent } from "../../adapters/discovery/search-hub.js";
import { deduplicateCandidates } from "../../utils/dedup.js";

function err(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export async function handleSearchPapers(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const query = args.query as string | undefined;
  if (!query) return err("Query is required");

  const sources = (args.sources as string[]) ?? undefined;
  const limitStr = args.limit as number | undefined;
  const limit = limitStr ? Math.min(Math.max(limitStr, 1), 50) : 10;
  
  const yearRangeRaw = args.year_range as Record<string, unknown> | undefined;
  let yearRange: { start?: number; end?: number } | undefined;
  if (yearRangeRaw) {
    yearRange = {
      start: typeof yearRangeRaw.start === "number" ? yearRangeRaw.start : undefined,
      end: typeof yearRangeRaw.end === "number" ? yearRangeRaw.end : undefined,
    };
  }

  try {
    const rawResults = await searchConcurrent(config, query, limit, sources, yearRange);
    const deduplicated = deduplicateCandidates(rawResults);
    return ok({
      metadata: { query, sources_queried: sources ?? "all_enabled", total_results: deduplicated.length },
      papers: deduplicated,
    });
  } catch (e) {
    return err(`search_papers failed: ${(e as Error).message}`);
  }
}

export async function handleSearchSingleSource(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const source = args.source as string;
  const query = args.query as string;
  if (!source || !query) return err("Source and query are required");

  const limitStr = args.limit as number | undefined;
  const limit = limitStr ? Math.min(Math.max(limitStr, 1), 100) : 20;

  const yearRangeRaw = args.year_range as Record<string, unknown> | undefined;
  let yearRange: { start?: number; end?: number } | undefined;
  if (yearRangeRaw) {
    yearRange = {
      start: typeof yearRangeRaw.start === "number" ? yearRangeRaw.start : undefined,
      end: typeof yearRangeRaw.end === "number" ? yearRangeRaw.end : undefined,
    };
  }

  try {
    const rawResults = await searchConcurrent(config, query, limit, [source], yearRange);
    return ok({
      metadata: { source, query, result_count: rawResults.length },
      papers: rawResults,
    });
  } catch (e) {
    return err(`search_single_source failed: ${(e as Error).message}`);
  }
}
