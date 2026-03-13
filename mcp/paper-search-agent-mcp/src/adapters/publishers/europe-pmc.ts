/**
 * Europe PMC adapter.
 * Implements both discovery search and free full-text XML retrieval.
 * Docs: https://europepmc.org/RestfulWebService
 */

import type { CandidatePaper } from "../../schemas/index.js";
import { fetchWithRetry } from "../../utils/http.js";

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

/**
 * Search Europe PMC for papers matching a query string.
 */
export async function searchEuropePmc(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("resultType", "core");
  params.set("pageSize", String(Math.min(yearRange?.start || yearRange?.end ? Math.max(limit * 2, limit) : limit, 100)));
  params.set("format", "json");

  const url = `${BASE}/search?${params.toString()}`;
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Europe PMC search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as EuropePmcSearchResponse;
  const mapped = (data.resultList?.result ?? []).map((result, index) => resultToCandidatePaper(result, index));

  const filtered = mapped.filter((paper) => {
    if (!paper.year) return true;
    if (yearRange?.start && paper.year < yearRange.start) return false;
    if (yearRange?.end && paper.year > yearRange.end) return false;
    return true;
  });

  return filtered.slice(0, limit);
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
  const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { available: false, pmcId: null };

  const data = (await res.json()) as EuropePmcSearchResponse;
  const result = data.resultList?.result?.[0];
  if (!result) return { available: false, pmcId: null };

  const hasFreeFulltext =
    result.isOpenAccess === "Y" ||
    result.inEPMC === "Y" ||
    (result.fullTextUrlList?.fullTextUrl ?? []).some(
      (urlInfo) => urlInfo.availabilityCode === "OA" || urlInfo.documentStyle === "xml",
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
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Europe PMC fulltext failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  if (!xml || xml.length < 100) return null;
  return { xml };
}

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

function resultToCandidatePaper(result: EuropePmcResult, rank: number): CandidatePaper {
  const doi = result.doi?.toLowerCase() ?? null;
  const authors = result.authorString
    ? result.authorString.split(", ").map((author) => author.replace(/\.$/, ""))
    : [];

  return {
    doi,
    title: result.title ?? "Untitled",
    authors,
    venue: result.journalTitle ?? null,
    year: result.pubYear ? parseInt(result.pubYear, 10) : null,
    abstract: result.abstractText ?? null,
    source: "europe_pmc",
    source_rank: rank,
    publisher_hint: null,
    open_access_hint: result.isOpenAccess === "Y" || result.inEPMC === "Y",
    landing_page_url: doi ? `https://doi.org/${doi}` : null,
  };
}
