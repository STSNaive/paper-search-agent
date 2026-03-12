/**
 * Springer Meta API v2 discovery adapter.
 * Searches Springer Nature metadata for papers.
 * Docs: https://dev.springernature.com/docs
 */

import type { CandidatePaper } from "../../schemas/index.js";
import { publisherFromDoiPrefix } from "../../utils/doi.js";

const BASE = "https://api.springernature.com/meta/v2/json";

/**
 * Search Springer Nature Meta API by query string.
 */
export async function searchSpringerMeta(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const apiKey = process.env.SPRINGER_API_KEY;
  if (!apiKey) {
    throw new Error("SPRINGER_API_KEY is required for Springer Meta API");
  }

  // Build constraint query
  let q = `keyword:${query}`;
  if (yearRange?.start || yearRange?.end) {
    const start = yearRange?.start ?? 1900;
    const end = yearRange?.end ?? new Date().getFullYear();
    q += ` year:${start}-${end}`;
  }

  const params = new URLSearchParams();
  params.set("q", q);
  params.set("api_key", apiKey);
  params.set("p", String(Math.min(limit, 50)));

  const url = `${BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Springer Meta search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as SpringerMetaResponse;
  const records = data.records ?? [];
  return records.map((rec, i) => recordToCandidatePaper(rec, i));
}

// ── Internal types ────────────────────────────────────────────────

interface SpringerMetaResponse {
  result?: Array<{ total: string; start: string; pageLength: string }>;
  records?: SpringerRecord[];
}

interface SpringerRecord {
  contentType?: string;
  identifier?: string;
  language?: string;
  url?: Array<{ format: string; platform: string; value: string }>;
  title?: string;
  creators?: Array<{ creator: string }>;
  publicationName?: string;
  openaccess?: string;
  doi?: string;
  publisher?: string;
  publicationDate?: string;
  abstract?: string;
}

function recordToCandidatePaper(rec: SpringerRecord, rank: number): CandidatePaper {
  const doi = rec.doi ?? rec.identifier?.replace("doi:", "") ?? null;
  const year = rec.publicationDate
    ? parseInt(rec.publicationDate.split("-")[0], 10) || null
    : null;

  const htmlUrl = rec.url?.find((u) => u.format === "html")?.value ?? null;

  return {
    doi,
    title: rec.title ?? "Untitled",
    authors: (rec.creators ?? []).map((c) => c.creator),
    venue: rec.publicationName ?? null,
    year,
    abstract: rec.abstract ?? null,
    source: "springer_meta",
    source_rank: rank,
    publisher_hint: doi ? publisherFromDoiPrefix(doi) ?? "springer" : "springer",
    open_access_hint: rec.openaccess === "true",
    landing_page_url: htmlUrl,
  };
}
