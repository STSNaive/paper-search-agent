import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "../../config.js";
import { fetchFulltext } from "../../adapters/retrieval/fulltext-fetcher.js";
import { parsePaper } from "../../adapters/parsing/paper-parser.js";
import { AccessPlan } from "../../schemas/index.js";
import { browserRetrieve } from "../../adapters/browser/playwright-retriever.js";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { extname, basename, join } from "node:path";
import { saveParsedRecord } from "../../adapters/storage/local-store.js";

function err(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export async function handleFetchFulltext(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const planRaw = args.plan as AccessPlan | undefined;
  if (!planRaw || !planRaw.doi) {
    return err("Valid AccessPlan with DOI is required");
  }

  try {
    const retrievalResult = await fetchFulltext(planRaw, config, config.paths.cache_dir);
    if (!retrievalResult.success || !retrievalResult.artifact_path) {
      return ok({
        status: "failed",
        message: "All retrieval routes failed.",
        attempts: retrievalResult.attempts,
      });
    }

    try {
      const parsed = await parsePaper(
        retrievalResult.artifact_path,
        retrievalResult.artifact_type ?? undefined,
        (planRaw as AccessPlan & { metadata?: unknown }).metadata as any,
      );
      const safeName = planRaw.doi.replace(/[/\\:*?"<>|]/g, "_");
      saveParsedRecord(safeName, parsed, config.paths.cache_dir);

      return ok({
        status: "success",
        retrieval: retrievalResult,
        parsed_summary: {
          title: parsed.metadata.title,
          extracted_text_length: parsed.extracted_text.length,
          sections_found: Object.keys(parsed.sections),
          references_found: parsed.references.length,
        },
        paper_id: safeName,
      });
    } catch (parseErr) {
      return ok({
        status: "partial_success",
        message: `Retrieved successfully to ${retrievalResult.artifact_path}, but parsing failed: ${(parseErr as Error).message}`,
        retrieval: retrievalResult,
      });
    }
  } catch (error) {
    return err(`fetch_fulltext failed: ${(error as Error).message}`);
  }
}

export async function handleImportLocalFile(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const filePath = args.file_path as string;
  if (!filePath) return err("file_path is required");
  if (!existsSync(filePath)) return err(`File not found: ${filePath}`);

  const doi = args.doi as string | undefined;
  const title = args.title as string | undefined;
  const paperId = doi ? doi.replace(/[/\\:*?"<>|]/g, "_") : basename(filePath, extname(filePath));

  const extension = extname(filePath).slice(1);
  const cacheDir = join(config.paths.cache_dir, "_manual_imports");
  mkdirSync(cacheDir, { recursive: true });
  const newPath = join(cacheDir, `${paperId}.${extension || "txt"}`);
  copyFileSync(filePath, newPath);

  try {
    const parsed = await parsePaper(newPath, undefined, { doi, title });
    saveParsedRecord(paperId, parsed, config.paths.cache_dir);
    return ok({
      status: "imported",
      file_path: newPath,
      paper_id: paperId,
      parsed_summary: {
        title: parsed.metadata.title,
        extracted_text_length: parsed.extracted_text.length,
        sections_found: Object.keys(parsed.sections),
        references_found: parsed.references.length,
      },
    });
  } catch (error) {
    return err(`Failed to parse imported file: ${(error as Error).message}`);
  }
}

export async function handleBrowserRetrieve(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const url = args.url as string | undefined;
  const doi = args.doi as string | undefined;
  const action = (args.action as "navigate" | "check" | "close") ?? "navigate";

  if (action === "navigate" && !url) {
    return err("'url' is required for navigate action. Provide the paper's landing page URL.");
  }

  const result = await browserRetrieve(
    url ?? "",
    config.browser.state_directory,
    config.paths.cache_dir,
    doi ?? null,
    action,
  );

  return ok(result);
}
