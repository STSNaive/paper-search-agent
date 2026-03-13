/**
 * Semantic Scholar discovery adapter.
 * Uses the Semantic Scholar Graph API for searching academic papers.
 * Docs: https://api.semanticscholar.org/api-docs/graph#tag/Paper-Data/operation/get_graph_get_paper_search
 */

import type { CandidatePaper } from "../../schemas/index.js";
import { normalizeDoi, publisherFromDoiPrefix } from "../../utils/doi.js";
import { fetchWithRetry } from "../../utils/http.js";

const BASE = "https://api.semanticscholar.org/graph/v1";

/**
 * Search Semantic Scholar by query string.
 */
export async function searchSemanticScholar(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("limit", String(Math.min(limit, 100)));
  
  const fields = [
    "title",
    "authors",
    "venue",
    "year",
    "abstract",
    "externalIds",
    "url",
    "isOpenAccess",
    "openAccessPdf",
  ].join(",");
  params.set("fields", fields);

  if (yearRange?.start && yearRange?.end) {
    params.set("year", `${yearRange.start}-${yearRange.end}`);
  } else if (yearRange?.start) {
    params.set("year", `${yearRange.start}-`);
  } else if (yearRange?.end) {
    params.set("year", `-${yearRange.end}`);
  }

  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const url = `${BASE}/paper/search?${params.toString()}`;
  const res = await fetchWithRetry(url, { headers });
  
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Semantic Scholar search failed: ${res.status} — ${body.substring(0, 200)}`);
  }

  const data = (await res.json()) as SemanticScholarSearchResponse;
  return (data.data ?? []).map((p, i) => resultToCandidatePaper(p, i));
}

// ── Internal types ────────────────────────────────────────────────

interface SemanticScholarSearchResponse {
  total: number;
  offset: number;
  data?: SemanticScholarPaper[];
}

interface SemanticScholarPaper {
  paperId: string;
  title?: string;
  abstract?: string;
  venue?: string;
  year?: number;
  url?: string;
  authors?: Array<{ authorId: string; name: string }>;
  externalIds?: {
    DOI?: string;
    CorpusId?: string;
    PubMed?: string;
    PubMedCentral?: string;
    MAG?: string;
    ArXiv?: string;
  };
  isOpenAccess?: boolean;
  openAccessPdf?: {
    url: string;
    status: string;
  };
}

function resultToCandidatePaper(p: SemanticScholarPaper, rank: number): CandidatePaper {
  const doi = p.externalIds?.DOI ? normalizeDoi(p.externalIds.DOI) : null;
  const authors = p.authors?.map((a) => a.name) ?? [];
  const venue = p.venue || null;

  return {
    doi,
    title: p.title ?? "Untitled",
    authors,
    venue,
    year: p.year ?? null,
    abstract: p.abstract ?? null,
    source: "semantic_scholar",
    source_rank: rank,
    publisher_hint: doi ? publisherFromDoiPrefix(doi) : null,
    open_access_hint: p.isOpenAccess ?? !!p.openAccessPdf,
    landing_page_url: p.url ?? null,
  };
}
