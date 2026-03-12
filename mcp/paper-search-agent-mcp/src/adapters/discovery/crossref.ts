/**
 * Crossref discovery adapter.
 * Implements Works API search and per-DOI metadata resolution.
 * Docs: https://api.crossref.org/swagger-ui/index.html
 */

import type { CandidatePaper } from "../../schemas/index.js";
import { publisherFromDoiPrefix } from "../../utils/doi.js";

const BASE = "https://api.crossref.org";

/** Polite-pool mailto for better rate limits. */
function mailto(): string {
  return process.env.CROSSREF_EMAIL ?? process.env.UNPAYWALL_EMAIL ?? "";
}

/**
 * Search Crossref Works API by query string.
 */
export async function searchCrossref(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("rows", String(Math.min(limit, 1000)));
  params.set("sort", "relevance");

  // Year filter via Crossref API filter syntax
  const filters: string[] = [];
  if (yearRange?.start) filters.push(`from-pub-date:${yearRange.start}`);
  if (yearRange?.end) filters.push(`until-pub-date:${yearRange.end}`);
  if (filters.length) params.set("filter", filters.join(","));

  const email = mailto();
  if (email) params.set("mailto", email);

  const url = `${BASE}/works?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Crossref search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as CrossrefResponse;
  const items = data.message?.items ?? [];
  return items.map((item, i) => itemToCandidatePaper(item, i));
}

/**
 * Resolve a DOI via Crossref to get publisher, title, and other metadata.
 */
export async function resolveDoiViaCrossref(
  doi: string,
): Promise<CrossrefResolvedDoi | null> {
  const params = new URLSearchParams();
  const email = mailto();
  if (email) params.set("mailto", email);

  const url = `${BASE}/works/${encodeURIComponent(doi)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Crossref DOI resolve failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { message: CrossrefItem };
  const item = data.message;

  return {
    doi: item.DOI?.toLowerCase() ?? doi.toLowerCase(),
    title: titleFromItem(item),
    publisher: item.publisher ?? null,
    publisher_hint: publisherFromDoiPrefix(doi) ?? guessPublisher(item.publisher),
    container_title: item["container-title"]?.[0] ?? null,
    type: item.type ?? null,
    url: item.URL ?? null,
  };
}

// ── Exported types ────────────────────────────────────────────────

export interface CrossrefResolvedDoi {
  doi: string;
  title: string | null;
  publisher: string | null;
  publisher_hint: string | null;
  container_title: string | null;
  type: string | null;
  url: string | null;
}

// ── Internal types & helpers ──────────────────────────────────────

interface CrossrefResponse {
  message?: { items?: CrossrefItem[] };
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string }[];
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  publisher?: string;
  type?: string;
  URL?: string;
  link?: { URL?: string; "content-type"?: string }[];
  abstract?: string;
}

function titleFromItem(item: CrossrefItem): string | null {
  return item.title?.[0] ?? null;
}

function extractYear(item: CrossrefItem): number | null {
  const dp =
    item.published?.["date-parts"]?.[0] ??
    item["published-print"]?.["date-parts"]?.[0] ??
    item["published-online"]?.["date-parts"]?.[0];
  return dp?.[0] ?? null;
}

function itemToCandidatePaper(item: CrossrefItem, rank: number): CandidatePaper {
  const doi = item.DOI?.toLowerCase() ?? null;
  const authors = (item.author ?? []).map(
    (a) => [a.given, a.family].filter(Boolean).join(" "),
  );

  return {
    doi,
    title: titleFromItem(item) ?? "Untitled",
    authors,
    venue: item["container-title"]?.[0] ?? null,
    year: extractYear(item),
    abstract: item.abstract ?? null,
    source: "crossref",
    source_rank: rank,
    publisher_hint: doi ? publisherFromDoiPrefix(doi) : guessPublisher(item.publisher),
    open_access_hint: null, // Crossref doesn't directly report OA status
    landing_page_url: item.URL ?? null,
  };
}

function guessPublisher(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("elsevier")) return "elsevier";
  if (lower.includes("springer")) return "springer";
  if (lower.includes("wiley")) return "wiley";
  if (lower.includes("ieee")) return "ieee";
  if (lower.includes("acm")) return "acm";
  if (lower.includes("plos")) return "plos";
  if (lower.includes("frontiers")) return "frontiers";
  if (lower.includes("taylor") && lower.includes("francis")) return "taylor_francis";
  if (lower.includes("sage")) return "sage";
  if (lower.includes("oxford")) return "oup";
  if (lower.includes("cambridge")) return "cup";
  return null;
}
