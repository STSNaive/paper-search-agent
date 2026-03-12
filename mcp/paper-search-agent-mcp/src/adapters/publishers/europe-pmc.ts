/**
 * Europe PMC adapter.
 * Implements both discovery search and free full-text XML retrieval.
 * Docs: https://europepmc.org/RestfulWebService
 */

import type { CandidatePaper } from "../../schemas/index.js";

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

/**
 * Search Europe PMC for papers matching a query string.
 */
export async function searchEuropePmc(
  query: string,
  limit: number = 20,
): Promise<CandidatePaper[]> {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("resultType", "core");
  params.set("pageSize", String(Math.min(limit, 100)));
  params.set("format", "json");

  const url = `${BASE}/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Europe PMC search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as EuropePmcSearchResponse;
  return (data.resultList?.result ?? []).map((r, i) => resultToCandidatePaper(r, i));
}

/**
 * Check if a paper has free full-text XML available in Europe PMC.
 */
export async function checkEuropePmcFulltext(
  doi: string,
): Promise<{ available: boolean; pmcId: string | null }> {
  const params = new URLSearchParams();
  params.set("query", `DOI:${doi}`);
  params.set("resultType", "core");
  params.set("pageSize", "1");
  params.set("format", "json");

  const url = `${BASE}/search?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { available: false, pmcId: null };

  const data = (await res.json()) as EuropePmcSearchResponse;
  const result = data.resultList?.result?.[0];
  if (!result) return { available: false, pmcId: null };

  const hasFreeFulltext =
    result.isOpenAccess === "Y" ||
    result.inEPMC === "Y" ||
    (result.fullTextUrlList?.fullTextUrl ?? []).some(
      (u) => u.availabilityCode === "OA" || u.documentStyle === "xml",
    );

  return {
    available: hasFreeFulltext,
    pmcId: result.pmcid ?? null,
  };
}

/**
 * Fetch full-text JATS XML for a paper from Europe PMC.
 * Requires a PMC ID (e.g., "PMC1234567").
 */
export async function fetchEuropePmcFulltext(
  pmcId: string,
): Promise<{ xml: string } | null> {
  const url = `${BASE}/${encodeURIComponent(pmcId)}/fullTextXML`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Europe PMC fulltext failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  if (!xml || xml.length < 100) return null;
  return { xml };
}

// ── Internal types & helpers ──────────────────────────────────────

interface EuropePmcSearchResponse {
  resultList?: {
    result?: EuropePmcResult[];
  };
}

interface EuropePmcResult {
  doi?: string;
  title?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
  abstractText?: string;
  pmcid?: string;
  pmid?: string;
  isOpenAccess?: string;
  inEPMC?: string;
  fullTextUrlList?: {
    fullTextUrl?: { availabilityCode?: string; documentStyle?: string; url?: string }[];
  };
}

function resultToCandidatePaper(r: EuropePmcResult, rank: number): CandidatePaper {
  const doi = r.doi?.toLowerCase() ?? null;
  const authors = r.authorString
    ? r.authorString.split(", ").map((a) => a.replace(/\.$/, ""))
    : [];

  return {
    doi,
    title: r.title ?? "Untitled",
    authors,
    venue: r.journalTitle ?? null,
    year: r.pubYear ? parseInt(r.pubYear, 10) : null,
    abstract: r.abstractText ?? null,
    source: "europe_pmc",
    source_rank: rank,
    publisher_hint: null,
    open_access_hint: r.isOpenAccess === "Y" || r.inEPMC === "Y",
    landing_page_url: doi ? `https://doi.org/${doi}` : null,
  };
}
