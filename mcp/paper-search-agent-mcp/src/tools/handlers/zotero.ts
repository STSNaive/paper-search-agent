import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "../../config.js";
import { loadZoteroConfig, zoteroListCollections, zoteroLookup, zoteroSave } from "../../adapters/integrations/zotero.js";

function err(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export async function handleZoteroLookup(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const cfg = loadZoteroConfig();
  if (!cfg) {
    return err("Zotero not configured. Set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID in .env");
  }

  const doi = args.doi as string | undefined;
  const title = args.title as string | undefined;
  const query = args.query as string | undefined;

  if (!doi && !title && !query) {
    return err("At least one of 'doi', 'title', or 'query' is required");
  }

  try {
    const result = await zoteroLookup(cfg, { doi, title, query });
    return ok(result);
  } catch (e) {
    return err(`Zotero lookup failed: ${(e as Error).message}`);
  }
}

export async function handleZoteroSave(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const cfg = loadZoteroConfig();
  if (!cfg) {
    return err("Zotero not configured. Set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID in .env");
  }

  const doi = args.doi as string | undefined;
  const title = args.title as string | undefined;
  const metadata = args.metadata as Record<string, unknown> | undefined;

  if (!title && !doi) {
    return err("At least 'title' or 'doi' is required");
  }

  try {
    const result = await zoteroSave(cfg, {
      doi,
      title: (title ?? metadata?.title as string) ?? "Untitled",
      authors: (metadata?.authors as string[]) ?? [],
      year: (metadata?.year as string) ?? undefined,
      venue: (metadata?.venue as string) ?? undefined,
      abstract: (metadata?.abstract as string) ?? undefined,
      url: (metadata?.url as string) ?? undefined,
      tags: (metadata?.tags as string[]) ?? [],
      collections: (args.collections as string[]) ?? [],
    });
    return ok(result);
  } catch (e) {
    return err(`Zotero save failed: ${(e as Error).message}`);
  }
}

export async function handleZoteroListCollections(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const cfg = loadZoteroConfig();
  if (!cfg) {
    return err("Zotero not configured. Set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID in .env");
  }

  try {
    const collections = await zoteroListCollections(cfg);
    return ok({ collections, total: collections.length });
  } catch (e) {
    return err(`Zotero list collections failed: ${(e as Error).message}`);
  }
}
