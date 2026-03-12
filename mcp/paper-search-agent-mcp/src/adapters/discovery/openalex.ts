/**
 * OpenAlex discovery adapter.
 * Implements search via the OpenAlex Works API and per-DOI OA lookup.
 * Docs: https://docs.openalex.org/api-entities/works
 */

import type { CandidatePaper } from "../../schemas/index.js";

const BASE = "https://api.openalex.org";

/** Polite-pool email for better rate limits. */
function mailto(): string {
  return process.env.OPENALEX_EMAIL ?? process.env.UNPAYWALL_EMAIL ?? "";
}

/**
 * Build common query params. OpenAlex uses `mailto` in polite pool.
 */
function baseParams(): URLSearchParams {
  const p = new URLSearchParams();
  const email = mailto();
  if (email) p.set("mailto", email);
  return p;
}

/**
 * Search OpenAlex Works API by keyword / query string.
 */
export async function searchOpenAlex(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const params = baseParams();
  params.set("search", query);
  params.set("per_page", String(Math.min(limit, 200)));

  // Build filter for year range
  const filters: string[] = [];
  if (yearRange?.start) filters.push(`from_publication_date:${yearRange.start}-01-01`);
  if (yearRange?.end) filters.push(`to_publication_date:${yearRange.end}-12-31`);
  if (filters.length) params.set("filter", filters.join(","));

  const url = `${BASE}/works?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OpenAlex search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as OpenAlexResponse;
  return (data.results ?? []).map((w, i) => workToCandidatePaper(w, i));
}

/**
 * Look up a single DOI in OpenAlex to get OA status and metadata.
 */
export async function lookupOpenAlexByDoi(
  doi: string,
): Promise<{ paper: CandidatePaper; is_oa: boolean; best_oa_url: string | null } | null> {
  const params = baseParams();
  const url = `${BASE}/works/doi:${encodeURIComponent(doi)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`OpenAlex DOI lookup failed: ${res.status} ${res.statusText}`);
  }

  const w = (await res.json()) as OpenAlexWork;
  const paper = workToCandidatePaper(w, 0);

  const bestOa = w.best_oa_location?.url ?? w.best_oa_location?.pdf_url ?? null;
  return {
    paper,
    is_oa: w.open_access?.is_oa ?? false,
    best_oa_url: bestOa,
  };
}

// ── Internal types & helpers ──────────────────────────────────────

interface OpenAlexResponse {
  results: OpenAlexWork[];
}

interface OpenAlexWork {
  doi?: string;
  title?: string;
  display_name?: string;
  authorships?: { author: { display_name: string } }[];
  primary_location?: {
    source?: { display_name?: string };
    landing_page_url?: string;
  };
  publication_year?: number;
  abstract_inverted_index?: Record<string, number[]>;
  open_access?: { is_oa: boolean; oa_status?: string };
  best_oa_location?: { url?: string; pdf_url?: string };
}

function workToCandidatePaper(w: OpenAlexWork, rank: number): CandidatePaper {
  const rawDoi = w.doi ?? null;
  const doi = rawDoi ? rawDoi.replace("https://doi.org/", "").toLowerCase() : null;

  return {
    doi,
    title: w.display_name ?? w.title ?? "Untitled",
    authors: (w.authorships ?? []).map((a) => a.author.display_name),
    venue: w.primary_location?.source?.display_name ?? null,
    year: w.publication_year ?? null,
    abstract: invertedIndexToText(w.abstract_inverted_index),
    source: "openalex",
    source_rank: rank,
    publisher_hint: null, // will be inferred from DOI prefix later
    open_access_hint: w.open_access?.is_oa ?? null,
    landing_page_url: w.primary_location?.landing_page_url ?? null,
  };
}

/**
 * OpenAlex stores abstracts as inverted index {word: [positions]}.
 * Convert back to plain text.
 */
function invertedIndexToText(
  inv: Record<string, number[]> | undefined | null,
): string | null {
  if (!inv) return null;
  const entries: [string, number[]][] = Object.entries(inv);
  const words: string[] = [];
  for (const [word, positions] of entries) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.join(" ");
}
