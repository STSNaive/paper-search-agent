/**
 * Tool registration and dispatch hub.
 *
 * Each tool is defined with its JSON Schema and handler function.
 * Tools are conditionally registered based on config switches.
 */

import type { AppConfig } from "../config.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { enabledDiscoverySources } from "../config.js";
import { searchOpenAlex, lookupOpenAlexByDoi } from "../adapters/discovery/openalex.js";
import { searchCrossref, resolveDoiViaCrossref } from "../adapters/discovery/crossref.js";
import { lookupUnpaywall } from "../adapters/discovery/unpaywall.js";
import { searchEuropePmc } from "../adapters/publishers/europe-pmc.js";
import { searchSpringerMeta } from "../adapters/discovery/springer-meta.js";
import { searchScopus } from "../adapters/discovery/scopus.js";
import { searchArxiv } from "../adapters/discovery/arxiv.js";
import { searchPubMed } from "../adapters/discovery/pubmed.js";
import { createAccessPlan } from "../planners/access-planner.js";
import { fetchFulltext, importLocalFile } from "../adapters/retrieval/fulltext-fetcher.js";
import { parsePaper, extractSections } from "../adapters/parsing/paper-parser.js";
import { exportRecords } from "../adapters/export/exporter.js";
import { browserRetrieve } from "../adapters/browser/playwright-retriever.js";
import { zoteroLookup, zoteroSave, zoteroListCollections, loadZoteroConfig } from "../adapters/integrations/zotero.js";
import { normalizeDoi, publisherFromDoiPrefix } from "../utils/doi.js";
import { deduplicateCandidates } from "../utils/dedup.js";
import { estimateTokens, estimateSectionTokens, tokenBudgetAdvisory } from "../utils/token-budget.js";
import {
  checkCache,
  addToCorpus,
  listCorpus,
  removeFromCorpus,
  deduplicateCorpus,
  listAllCorpora,
} from "../adapters/storage/local-store.js";
import type { CandidatePaper, DiscoveryResult, NormalizedPaperRecord } from "../schemas/index.js";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Tool definitions ──────────────────────────────────────────────

export function getToolDefinitions(config: AppConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // A. Discovery Tools — always registered (individual sources controlled by config)
  tools.push({
    name: "search_papers",
    description:
      "Unified multi-source paper search. Queries enabled discovery sources " +
      "(OpenAlex, Crossref, Scopus, Springer Meta, arXiv, PubMed, Europe PMC, " +
      "Semantic Scholar, Unpaywall) and returns normalized CandidatePaper results. " +
      "Use sources[] to limit which sources are queried.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords" },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Specific sources to query (defaults to all enabled)",
        },
        year_range: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
          },
          description: "Filter by publication year range",
        },
        limit: { type: "number", description: "Maximum results per source (default: 20)" },
      },
      required: ["query"],
    },
  });

  tools.push({
    name: "search_single_source",
    description:
      "Search a specific discovery source with source-specific parameters. " +
      "Useful for fine-grained control over a single source.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Source to query (e.g., 'openalex', 'crossref', 'arxiv')",
        },
        query: { type: "string", description: "Search query" },
        params: {
          type: "object",
          description: "Source-specific parameters",
        },
        limit: { type: "number" },
      },
      required: ["source", "query"],
    },
  });

  // B. Resolution and Planning Tools
  tools.push({
    name: "resolve_and_plan",
    description:
      "Given a DOI or CandidatePaper, resolve the publisher, check OA status " +
      "(via OpenAlex + Unpaywall), check local cache, check Zotero library, " +
      "and return an AccessPlan with preferred route and fallbacks.",
    inputSchema: {
      type: "object",
      properties: {
        doi: { type: "string", description: "DOI to resolve" },
        candidate: {
          type: "object",
          description: "CandidatePaper object (alternative to DOI)",
        },
      },
    },
  });

  tools.push({
    name: "check_local_cache",
    description: "Check if a paper (by DOI or ID) is already stored locally.",
    inputSchema: {
      type: "object",
      properties: {
        doi: { type: "string" },
        paper_id: { type: "string" },
      },
    },
  });

  // C. Retrieval Tools
  tools.push({
    name: "fetch_fulltext",
    description:
      "Unified retrieval tool. Accepts an AccessPlan or DOI and executes the preferred " +
      "route: OA downloads, Elsevier API, Springer OA API, Europe PMC XML, Wiley TDM. " +
      "Returns the retrieved artifact path and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        doi: { type: "string" },
        access_plan: { type: "object", description: "AccessPlan to execute" },
        route_override: { type: "string", description: "Force a specific route" },
      },
    },
  });

  if (config.retrieval.browser_assisted) {
    tools.push({
      name: "browser_retrieve",
      description:
        "Open a paper's landing page in a visible browser for human-assisted download. " +
        "Pauses for user verification (CAPTCHA, login, cookie consent). " +
        "Saves browser state (cookies) after successful access for future sessions.\n" +
        "Actions: 'navigate' (open URL), 'check' (after human verification), 'close' (shut down browser).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to open (required for 'navigate' action)" },
          doi: { type: "string", description: "DOI for organizing downloaded artifacts" },
          action: {
            type: "string",
            enum: ["navigate", "check", "close"],
            description: "navigate: open page; check: after human interaction; close: shut down browser",
            default: "navigate",
          },
        },
      },
    });
  }

  tools.push({
    name: "import_local_file",
    description:
      "Import a PDF or other local file provided by the user. " +
      "Registers it in the local cache and prepares it for parsing.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the local file" },
        doi: { type: "string", description: "DOI to associate with this file (optional)" },
        title: { type: "string", description: "Paper title (optional)" },
      },
      required: ["file_path"],
    },
  });

  // D. Parsing and Reading Tools
  tools.push({
    name: "parse_paper",
    description:
      "Extract structured text from a retrieved artifact (XML, HTML, or plain text). " +
      "For PDFs, delegates to the Anthropic PDF skill by default. " +
      "Returns a NormalizedPaperRecord.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_path: { type: "string", description: "Path to the artifact file" },
        artifact_type: {
          type: "string",
          enum: ["xml", "html", "pdf", "text"],
          description: "Type of the artifact",
        },
      },
      required: ["artifact_path"],
    },
  });

  tools.push({
    name: "get_paper_sections",
    description:
      "Return specific sections (abstract, methods, results, etc.) from a " +
      "NormalizedPaperRecord. Supports selective extraction to manage token budgets.",
    inputSchema: {
      type: "object",
      properties: {
        paper_id: { type: "string", description: "Paper identifier" },
        sections: {
          type: "array",
          items: { type: "string" },
          description: "Section names to retrieve (e.g., ['abstract', 'methods', 'results'])",
        },
      },
      required: ["paper_id", "sections"],
    },
  });

  // E. Storage and Corpus Tools
  tools.push({
    name: "manage_corpus",
    description:
      "Save, retrieve, list, and de-duplicate papers in a topic corpus. " +
      "Supports operations: 'add', 'get', 'list', 'remove', 'deduplicate'.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["add", "get", "list", "remove", "deduplicate"],
        },
        corpus_name: { type: "string", description: "Name of the topic corpus" },
        paper_id: { type: "string" },
        doi: { type: "string" },
      },
      required: ["operation"],
    },
  });

  tools.push({
    name: "export_records",
    description: "Export paper records and metadata in various formats (JSON, CSV, BibTeX).",
    inputSchema: {
      type: "object",
      properties: {
        corpus_name: { type: "string" },
        format: { type: "string", enum: ["json", "csv", "bibtex"] },
        output_path: { type: "string" },
      },
      required: ["format"],
    },
  });

  // F. Integration Tools (conditional)
  if (config.integrations.zotero) {
    tools.push({
      name: "zotero_lookup",
      description:
        "Search the user's Zotero library (Web API mode) for existing papers and PDFs.",
      inputSchema: {
        type: "object",
        properties: {
          doi: { type: "string" },
          title: { type: "string" },
          query: { type: "string" },
        },
      },
    });

    tools.push({
      name: "zotero_save",
      description:
        "Save a retrieved paper to the user's Zotero library with metadata. " +
        "Use collections[] to assign to specific collections (use zotero_list_collections to get collection keys).",
      inputSchema: {
        type: "object",
        properties: {
          doi: { type: "string" },
          title: { type: "string" },
          metadata: {
            type: "object",
            description: "Paper metadata: authors (string[]), year, venue, abstract, url, tags (string[])",
          },
          collections: {
            type: "array",
            items: { type: "string" },
            description: "Collection keys to add the item to. Get keys from zotero_list_collections.",
          },
        },
      },
    });

    tools.push({
      name: "zotero_list_collections",
      description:
        "List all collections in the user's Zotero library. " +
        "Returns collection keys and names that can be used with zotero_save.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    });
  }

  return tools;
}

// ── Tool dispatch ─────────────────────────────────────────────────

function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string): CallToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function notImplemented(name: string): CallToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "not_implemented",
          tool: name,
          message: `Tool '${name}' is registered but not yet implemented.`,
        }),
      },
    ],
  };
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  switch (name) {
    case "search_papers":
      return handleSearchPapers(args, config);
    case "search_single_source":
      return handleSearchSingleSource(args, config);
    case "resolve_and_plan":
      return handleResolveAndPlan(args, config);
    case "check_local_cache":
      return handleCheckLocalCache(args);
    case "manage_corpus":
      return handleManageCorpus(args);
    case "fetch_fulltext":
      return handleFetchFulltext(args, config);
    case "import_local_file":
      return handleImportLocalFile(args);
    case "parse_paper":
      return handleParsePaper(args, config);
    case "get_paper_sections":
      return handleGetPaperSections(args, config);
    case "export_records":
      return handleExportRecords(args);
    case "browser_retrieve":
      return handleBrowserRetrieve(args);
    case "zotero_lookup":
      return handleZoteroLookup(args);
    case "zotero_save":
      return handleZoteroSave(args);
    case "zotero_list_collections":
      return handleZoteroListCollections();
    default:
      return err(`Unknown tool: ${name}`);
  }
}

// ── Handler implementations ───────────────────────────────────────

async function handleSearchPapers(
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  const query = args.query as string;
  if (!query) return err("'query' is required");

  const limit = (args.limit as number) ?? 20;
  const yearRange = args.year_range as { start?: number; end?: number } | undefined;

  // Determine which sources to query
  const requested = args.sources as string[] | undefined;
  const enabled = enabledDiscoverySources(config);
  const sources = requested
    ? requested.filter((s) => enabled.includes(s))
    : enabled;

  const allCandidates: CandidatePaper[] = [];
  const errors: Record<string, string> = {};

  // Run enabled discovery sources in parallel
  const tasks: Promise<void>[] = [];

  if (sources.includes("openalex")) {
    tasks.push(
      searchOpenAlex(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((e: Error) => { errors.openalex = e.message; }),
    );
  }

  if (sources.includes("crossref")) {
    tasks.push(
      searchCrossref(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((e: Error) => { errors.crossref = e.message; }),
    );
  }

  if (sources.includes("europe_pmc")) {
    tasks.push(
      searchEuropePmc(query, limit)
        .then((results) => { allCandidates.push(...results); })
        .catch((e: Error) => { errors.europe_pmc = e.message; }),
    );
  }

  if (sources.includes("springer_meta")) {
    tasks.push(
      searchSpringerMeta(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((e: Error) => { errors.springer_meta = e.message; }),
    );
  }

  if (sources.includes("scopus")) {
    tasks.push(
      searchScopus(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((e: Error) => { errors.scopus = e.message; }),
    );
  }

  if (sources.includes("arxiv")) {
    tasks.push(
      searchArxiv(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((e: Error) => { errors.arxiv = e.message; }),
    );
  }

  if (sources.includes("pubmed")) {
    tasks.push(
      searchPubMed(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((e: Error) => { errors.pubmed = e.message; }),
    );
  }

  await Promise.all(tasks);

  // Enrich with publisher hints from DOI prefix
  for (const c of allCandidates) {
    if (c.doi && !c.publisher_hint) {
      c.publisher_hint = publisherFromDoiPrefix(c.doi);
    }
  }

  // Deduplicate across sources
  const deduplicated = deduplicateCandidates(allCandidates);

  const result: DiscoveryResult & { token_hint?: string } = {
    query,
    sources_queried: sources,
    total_results: deduplicated.length,
    candidates: deduplicated,
    deduplicated: true,
  };

  // Advisory: estimate total tokens in search results
  if (config.token_budget.abstract_first_triage) {
    const totalChars = deduplicated.reduce(
      (sum, c) => sum + (c.abstract?.length ?? 0) + (c.title?.length ?? 0), 0,
    );
    const est = estimateTokens(JSON.stringify(deduplicated));
    const max = config.token_budget.max_fulltext_tokens;
    if (est > max) {
      result.token_hint =
        `Search results are ~${est} tokens. Budget is ${max}. ` +
        `Consider narrowing the query, reducing limit, or reviewing titles first before reading abstracts.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return ok({ ...result, source_errors: errors });
  }
  return ok(result);
}

async function handleSearchSingleSource(
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  const source = args.source as string;
  const query = args.query as string;
  if (!source || !query) return err("'source' and 'query' are required");

  const limit = (args.limit as number) ?? 20;
  const enabled = enabledDiscoverySources(config);
  if (!enabled.includes(source)) {
    return err(`Source '${source}' is not enabled in config`);
  }

  let candidates: CandidatePaper[];

  switch (source) {
    case "openalex":
      candidates = await searchOpenAlex(query, limit);
      break;
    case "crossref":
      candidates = await searchCrossref(query, limit);
      break;
    case "europe_pmc":
      candidates = await searchEuropePmc(query, limit);
      break;
    case "springer_meta":
      candidates = await searchSpringerMeta(query, limit);
      break;
    case "scopus":
      candidates = await searchScopus(query, limit);
      break;
    case "arxiv":
      candidates = await searchArxiv(query, limit);
      break;
    case "pubmed":
      candidates = await searchPubMed(query, limit);
      break;
    default:
      return notImplemented(`search_single_source/${source}`);
  }

  // Enrich publisher hints
  for (const c of candidates) {
    if (c.doi && !c.publisher_hint) {
      c.publisher_hint = publisherFromDoiPrefix(c.doi);
    }
  }

  return ok({
    query,
    source,
    total_results: candidates.length,
    candidates,
  });
}

async function handleResolveAndPlan(
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  let doi = args.doi as string | undefined;
  const candidateArg = args.candidate as CandidatePaper | undefined;

  if (!doi && !candidateArg) {
    return err("Either 'doi' or 'candidate' is required");
  }

  // Build a CandidatePaper from DOI if only DOI was given
  let candidate: CandidatePaper;

  if (candidateArg) {
    candidate = candidateArg;
    if (!doi && candidateArg.doi) doi = candidateArg.doi;
  } else {
    doi = normalizeDoi(doi!);
    // Try to resolve metadata from OpenAlex or Crossref
    let title = "Unknown";
    let publisher_hint: string | null = publisherFromDoiPrefix(doi);

    try {
      const oaInfo = await lookupOpenAlexByDoi(doi);
      if (oaInfo) {
        title = oaInfo.paper.title;
        candidate = oaInfo.paper;
      } else {
        candidate = {
          doi,
          title,
          authors: [],
          venue: null,
          year: null,
          abstract: null,
          source: "doi_input",
          source_rank: null,
          publisher_hint,
          open_access_hint: null,
          landing_page_url: null,
        };
      }
    } catch {
      candidate = {
        doi,
        title,
        authors: [],
        venue: null,
        year: null,
        abstract: null,
        source: "doi_input",
        source_rank: null,
        publisher_hint,
        open_access_hint: null,
        landing_page_url: null,
      };
    }
  }

  const plan = await createAccessPlan(candidate, config);
  return ok(plan);
}

async function handleCheckLocalCache(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const doi = args.doi as string | undefined;
  const paperId = args.paper_id as string | undefined;

  const key = doi ?? paperId;
  if (!key) return err("Either 'doi' or 'paper_id' is required");

  const result = checkCache(doi ? normalizeDoi(doi) : key);
  return ok(result);
}

async function handleManageCorpus(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const operation = args.operation as string;
  const corpusName = args.corpus_name as string | undefined;

  switch (operation) {
    case "list": {
      if (!corpusName) {
        // List all corpora
        return ok({ corpora: listAllCorpora() });
      }
      return ok({ corpus: corpusName, papers: listCorpus(corpusName) });
    }
    case "add": {
      if (!corpusName) return err("'corpus_name' is required for 'add'");
      const paperId = (args.paper_id ?? args.doi ?? "") as string;
      const doi = (args.doi as string) ?? null;
      if (!paperId) return err("'paper_id' or 'doi' is required for 'add'");
      const corpus = addToCorpus(corpusName, paperId, doi, paperId);
      return ok({ corpus: corpusName, total: corpus.papers.length });
    }
    case "remove": {
      if (!corpusName) return err("'corpus_name' is required for 'remove'");
      const pid = (args.paper_id ?? args.doi ?? "") as string;
      if (!pid) return err("'paper_id' or 'doi' is required for 'remove'");
      const c = removeFromCorpus(corpusName, pid);
      return ok({ corpus: corpusName, total: c.papers.length });
    }
    case "deduplicate": {
      if (!corpusName) return err("'corpus_name' is required for 'deduplicate'");
      const dc = deduplicateCorpus(corpusName);
      return ok({ corpus: corpusName, total: dc.papers.length });
    }
    default:
      return err(`Unknown corpus operation: ${operation}`);
  }
}

// ── Phase 2 + 3 handlers ─────────────────────────────────────────

async function handleFetchFulltext(
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  const doi = args.doi as string | undefined;
  const accessPlanArg = args.access_plan as Record<string, unknown> | undefined;
  const routeOverride = args.route_override as string | undefined;

  if (!doi && !accessPlanArg) {
    return err("Either 'doi' or 'access_plan' is required");
  }

  // If only DOI given, create an access plan first
  let plan;
  if (accessPlanArg) {
    // Use the provided plan directly
    plan = accessPlanArg as unknown as import("../schemas/index.js").AccessPlan;
  } else {
    // Build a quick candidate and plan from DOI
    const normalizedDoi = normalizeDoi(doi!);
    const candidate: CandidatePaper = {
      doi: normalizedDoi,
      title: "Unknown",
      authors: [],
      venue: null,
      year: null,
      abstract: null,
      source: "doi_input",
      source_rank: null,
      publisher_hint: publisherFromDoiPrefix(normalizedDoi),
      open_access_hint: null,
      landing_page_url: null,
    };
    plan = await createAccessPlan(candidate, config);
  }

  const result = await fetchFulltext(plan, config, "./cache", routeOverride);

  // Add format guidance for LLM consumers
  const formatNote =
    result.artifact_type === "xml"
      ? "Structured XML retrieved — use parse_paper for efficient section extraction (no vision model needed)."
      : result.artifact_type === "html" || result.artifact_type === "text"
        ? "Text-based format retrieved — use parse_paper for efficient extraction."
        : result.artifact_type === "pdf"
          ? "PDF retrieved — consider using parse_paper (delegates to PDF skill). If structured text routes are available, they are more token-efficient."
          : null;

  return ok({ ...result, format_note: formatNote });
}

async function handleImportLocalFile(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const filePath = args.file_path as string;
  if (!filePath) return err("'file_path' is required");

  const doi = (args.doi as string) ?? null;
  const title = (args.title as string) ?? null;

  const result = importLocalFile(filePath, doi, title);
  return ok(result);
}

async function handleParsePaper(
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  const artifactPath = args.artifact_path as string;
  if (!artifactPath) return err("'artifact_path' is required");

  const artifactType = args.artifact_type as string | undefined;
  const record = parsePaper(artifactPath, artifactType);

  const paperId = record.metadata.doi ?? `parsed:${Date.now()}`;

  // Persist to disk so get_paper_sections can retrieve it later
  saveParsedRecord(paperId, record);

  // Advisory token budget info — no hard truncation
  const maxTokens = config.token_budget.max_fulltext_tokens;
  const { perSection, total: totalTokens } = estimateSectionTokens(record.sections);
  const advisory = tokenBudgetAdvisory(totalTokens, maxTokens);

  return ok({
    paper_id: paperId,
    metadata: record.metadata,
    content_format: record.content_format,
    sections_available: Object.keys(record.sections),
    extracted_text_length: record.extracted_text.length,
    token_estimate: {
      total: totalTokens,
      budget: maxTokens,
      per_section: perSection,
    },
    ...(advisory ? { token_hint: advisory } : {}),
    references_count: record.references.length,
    figures_count: record.figures_index.length,
    tables_count: record.tables_index.length,
  });
}

// ── Parsed paper persistence ──────────────────────────────────────
import { existsSync as fsExists, mkdirSync as fsMkdir, writeFileSync as fsWrite, readFileSync as fsRead } from "node:fs";
import { resolve as pathResolve, join as pathJoin } from "node:path";

const PARSED_DIR = "./cache/_parsed";

function saveParsedRecord(paperId: string, record: NormalizedPaperRecord): void {
  fsMkdir(pathResolve(PARSED_DIR), { recursive: true });
  const safeName = paperId.replace(/[/\\:*?"<>|]/g, "_");
  fsWrite(
    pathJoin(pathResolve(PARSED_DIR), `${safeName}.json`),
    JSON.stringify(record),
    "utf-8",
  );
}

function loadParsedRecord(paperId: string): NormalizedPaperRecord | null {
  const safeName = paperId.replace(/[/\\:*?"<>|]/g, "_");
  const p = pathJoin(pathResolve(PARSED_DIR), `${safeName}.json`);
  if (!fsExists(p)) return null;
  return JSON.parse(fsRead(p, "utf-8")) as NormalizedPaperRecord;
}

function loadAllParsedRecords(): NormalizedPaperRecord[] {
  const dir = pathResolve(PARSED_DIR);
  if (!fsExists(dir)) return [];
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => JSON.parse(fsRead(pathJoin(dir, f), "utf-8")) as NormalizedPaperRecord);
}

async function handleGetPaperSections(
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<CallToolResult> {
  const paperId = args.paper_id as string;
  const sectionNames = args.sections as string[];
  if (!paperId || !sectionNames) return err("'paper_id' and 'sections' are required");

  const record = loadParsedRecord(paperId);
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

async function handleExportRecords(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const format = args.format as "json" | "csv" | "bibtex";
  if (!format) return err("'format' is required");

  const corpusName = args.corpus_name as string | undefined;
  const outputPath = args.output_path as string | undefined;

  // Collect papers: either from corpus or from parsed papers
  let papers: Array<NormalizedPaperRecord | import("../adapters/storage/local-store.js").CorpusPaperRef>;

  if (corpusName) {
    papers = listCorpus(corpusName);
  } else {
    papers = loadAllParsedRecords();
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

async function handleBrowserRetrieve(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const url = args.url as string | undefined;
  const doi = args.doi as string | undefined;
  const action = (args.action as "navigate" | "check" | "close") ?? "navigate";

  if (action === "navigate" && !url) {
    return err("'url' is required for navigate action. Provide the paper's landing page URL.");
  }

  const result = await browserRetrieve(
    url ?? "",
    "./browser-state",
    "./cache",
    doi ?? null,
    action,
  );

  return ok(result);
}

// ── Zotero handlers ───────────────────────────────────────────────

async function handleZoteroLookup(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
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

async function handleZoteroSave(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
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

async function handleZoteroListCollections(): Promise<CallToolResult> {
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
