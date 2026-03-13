import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "../../config.js";
import { parsePaper, extractSections } from "../../adapters/parsing/paper-parser.js";
import { estimateSectionTokens, tokenBudgetAdvisory } from "../../utils/token-budget.js";
import { loadParsedRecord, saveParsedRecord } from "../../adapters/storage/local-store.js"; // This will be created soon

function err(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export async function handleParsePaper(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const filePath = args.file_path as string | undefined;
  const artifactType = args.artifact_type as string | undefined;
  const paperId = args.paper_id as string | undefined;

  if (!filePath || !paperId) {
    return err("file_path and paper_id are required");
  }

  try {
    const parsed = await parsePaper(filePath, artifactType);
    saveParsedRecord(paperId, parsed, config.paths.cache_dir);
    return ok({
      paper_id: paperId,
      metadata: parsed.metadata,
      sections_available: Object.keys(parsed.sections),
      total_length: parsed.extracted_text.length,
    });
  } catch (e) {
    return err(`parse_paper failed: ${(e as Error).message}`);
  }
}

export async function handleGetPaperSections(args: Record<string, unknown>, config: AppConfig): Promise<CallToolResult> {
  const paperId = args.paper_id as string;
  const sectionNames = args.sections as string[];
  if (!paperId || !sectionNames) return err("'paper_id' and 'sections' are required");

  const record = loadParsedRecord(paperId, config.paths.cache_dir);
  if (!record) {
    return err(`Paper '${paperId}' not found. Use parse_paper first to parse an artifact.`);
  }

  const extracted = extractSections(record, sectionNames);

  // Advisory token budget info — no hard truncation
  const maxTokens = config.token_budget.max_fulltext_tokens;
  const { perSection, total: totalTokens } = estimateSectionTokens(extracted);
  const advisory = tokenBudgetAdvisory(totalTokens, maxTokens);

  return ok({
    paper_id: paperId,
    requested: sectionNames,
    sections: extracted,
    available: Object.keys(record.sections),
    token_estimate: {
      total: totalTokens,
      budget: maxTokens,
      per_section: perSection,
    },
    ...(advisory ? { token_hint: advisory } : {}),
  });
}
