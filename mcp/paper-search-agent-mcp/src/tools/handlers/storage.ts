import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "../../config.js";
import { addToCorpus, listCorpus, removeFromCorpus, listAllCorpora, deduplicateCorpus, CorpusPaperRef } from "../../adapters/storage/local-store.js";
import { exportRecords } from "../../adapters/export/exporter.js";
import { loadAllParsedRecords } from "../../adapters/storage/local-store.js";
import type { NormalizedPaperRecord } from "../../schemas/index.js";

function err(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export async function handleManageCorpus(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const action = args.action as "add" | "remove" | "list" | "list_all";
  if (!action) return err("'action' is required");

  if (action === "list_all") {
    return ok({ corpora: listAllCorpora(config.paths.corpus_dir) });
  }

  const corpusName = args.corpus_name as string | undefined;
  if (!corpusName) return err("'corpus_name' is required for this action");

  const paperId = args.paper_id as string | undefined;

  switch (action) {
    case "list": {
      const papers = listCorpus(corpusName, config.paths.corpus_dir);
      return ok({ corpus: corpusName, count: papers.length, papers });
    }
    case "add": {
      if (!paperId) return err("'paper_id' is required for 'add'");
      const doi = (args.doi as string) ?? null;
      const title = (args.title as string) ?? "Untitled";
      addToCorpus(corpusName, paperId, doi, title, config.paths.corpus_dir);
      const updated = listCorpus(corpusName, config.paths.corpus_dir);
      return ok({ action: "added", corpus: updated });
    }
    case "remove": {
      if (!paperId) return err("'paper_id' is required for 'remove'");
      removeFromCorpus(corpusName, paperId, config.paths.corpus_dir);
      const updated = listCorpus(corpusName, config.paths.corpus_dir);
      return ok({ action: "removed", corpus: updated });
    }
    default:
      return err(`Unknown action: ${action}`);
  }
}

export async function handleExportRecords(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const format = args.format as "json" | "csv" | "bibtex";
  if (!format) return err("'format' is required");

  const corpusName = args.corpus_name as string | undefined;
  const outputPath = args.output_path as string | undefined;

  // Collect papers: either from corpus or from parsed papers
  let papers: Array<NormalizedPaperRecord | CorpusPaperRef>;

  if (corpusName) {
    papers = listCorpus(corpusName, config.paths.corpus_dir);
  } else {
    papers = loadAllParsedRecords(config.paths.cache_dir);
  }

  if (papers.length === 0) {
    return err("No papers to export. Specify a corpus_name or parse papers first.");
  }

  const output = exportRecords(papers, { format, outputPath });
  return ok({
    format,
    record_count: papers.length,
    output_path: outputPath ?? null,
    preview: output.length > 2000 ? output.slice(0, 2000) + "\n... (truncated)" : output,
  });
}
