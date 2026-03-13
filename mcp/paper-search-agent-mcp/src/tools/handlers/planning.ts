import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CandidatePaper } from "../../schemas/index.js";
import { AppConfig } from "../../config.js";
import { resolveDoiViaCrossref } from "../../adapters/discovery/crossref.js";
import { createAccessPlan } from "../../planners/access-planner.js";
import { checkCache } from "../../adapters/storage/local-store.js";

function err(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export async function handleResolveAndPlan(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const doi = args.doi as string | undefined;
  if (!doi) return err("DOI is required");

  try {
    const resolution = await resolveDoiViaCrossref(doi);
    if (!resolution) {
      return err(`Could not resolve DOI: ${doi}`);
    }
    const candidate: CandidatePaper = {
      doi: resolution.doi,
      title: resolution.title ?? "Unknown Title",
      authors: [], // CrossrefResolvedDoi doesn't export authors, we can fetch them via lookup or leave empty
      venue: resolution.publisher,
      year: null, // CrossrefResolvedDoi doesn't export year
      open_access_hint: null,
      landing_page_url: resolution.url ?? null,
      source: "crossref_resolve",
      source_rank: 0,
      abstract: null,
      publisher_hint: resolution.publisher_hint,
    };
    const plan = await createAccessPlan(candidate, config);
    return ok({ resolution, plan });
  } catch (e) {
    return err(`resolve_and_plan failed: ${(e as Error).message}`);
  }
}

export async function handleCheckLocalCache(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const doi = args.doi as string | undefined;
  if (!doi) return err("DOI is required");

  const { found, path: cachePath, entry } = checkCache(doi, config.paths.cache_dir);
  return ok({ found, path: cachePath, entry });
}
