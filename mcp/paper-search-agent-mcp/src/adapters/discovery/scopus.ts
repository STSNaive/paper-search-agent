/**
 * Scopus (Elsevier) discovery adapter.
 * Searches Scopus via the Elsevier API using the same API key as Article Retrieval.
 * Docs: https://dev.elsevier.com/documentation/SCOPUSSearchAPI.wadl
 */

import type { CandidatePaper } from "../../schemas/index.js";
import { publisherFromDoiPrefix } from "../../utils/doi.js";
import { fetchWithRetry } from "../../utils/http.js";

const BASE = "https://api.elsevier.com/content/search/scopus";

/**
 * Search Scopus by query string.
 */
export async function searchScopus(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const apiKey = process.env.ELSEVIER_API_KEY;
  if (!apiKey) {
    throw new Error("ELSEVIER_API_KEY is required for Scopus search");
  }

  // Build Scopus query
  let scopusQuery = `TITLE-ABS-KEY(${query})`;
  if (yearRange?.start && yearRange?.end) {
    scopusQuery += ` AND PUBYEAR > ${yearRange.start - 1} AND PUBYEAR < ${yearRange.end + 1}`;
  } else if (yearRange?.start) {
    scopusQuery += ` AND PUBYEAR > ${yearRange.start - 1}`;
  } else if (yearRange?.end) {
    scopusQuery += ` AND PUBYEAR < ${yearRange.end + 1}`;
  }

  const params = new URLSearchParams();
  params.set("query", scopusQuery);
  params.set("count", String(Math.min(limit, 25)));
  params.set("sort", "relevancy");

  const url = `${BASE}?${params.toString()}`;
  const res = await fetchWithRetry(url, {
    headers: {
      Accept: "application/json",
      "X-ELS-APIKey": apiKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Scopus search failed: ${res.status} — ${body.substring(0, 200)}`);
  }

  const data = (await res.json()) as ScopusResponse;
  const entries = data["search-results"]?.entry ?? [];

  // Filter out error entries (Scopus returns error objects in the entry array)
  const validEntries = entries.filter(
    (e) => !e.error && e["dc:title"],
  );

  return validEntries.map((entry, i) => entryToCandidatePaper(entry, i));
}

// ── Internal types ────────────────────────────────────────────────

interface ScopusResponse {
  "search-results"?: {
    "opensearch:totalResults"?: string;
    entry?: ScopusEntry[];
  };
}

interface ScopusEntry {
  error?: string;
  "dc:identifier"?: string;
  "dc:title"?: string;
  "dc:creator"?: string;
  "prism:publicationName"?: string;
  "prism:coverDate"?: string;
  "prism:doi"?: string;
  "prism:url"?: string;
  "citedby-count"?: string;
  openaccess?: string;
  "openaccessFlag"?: boolean;
  link?: Array<{ "@ref": string; "@href": string }>;
  subtypeDescription?: string;
}

function entryToCandidatePaper(entry: ScopusEntry, rank: number): CandidatePaper {
  const doi = entry["prism:doi"] ?? null;
  const coverDate = entry["prism:coverDate"];
  const year = coverDate ? parseInt(coverDate.split("-")[0], 10) || null : null;

  // Get the Scopus abstract page link
  const scopusLink = entry.link?.find((l) => l["@ref"] === "scopus")?.["@href"] ?? null;

  return {
    doi,
    title: entry["dc:title"] ?? "Untitled",
    authors: entry["dc:creator"] ? [entry["dc:creator"]] : [],
    venue: entry["prism:publicationName"] ?? null,
    year,
    abstract: null,  // Scopus search doesn't return abstracts in results
    source: "scopus",
    source_rank: rank,
    publisher_hint: doi ? publisherFromDoiPrefix(doi) : null,
    open_access_hint: entry["openaccessFlag"] ?? (entry.openaccess === "1"),
    landing_page_url: scopusLink,
  };
}
