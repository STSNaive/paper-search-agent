/**
 * PubMed discovery adapter.
 * Uses NCBI E-utilities (esearch + esummary) to search PubMed.
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 */

import type { CandidatePaper } from "../../schemas/index.js";
import { fetchWithRetry } from "../../utils/http.js";

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

/**
 * Search PubMed by keyword / query string.
 */
export async function searchPubMed(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  // Step 1: esearch �?get PMIDs
  const pmids = await esearch(query, limit, yearRange);
  if (pmids.length === 0) return [];

  // Step 2-3: esummary and efetch can run concurrently once we have PMIDs
  const [summaries, abstracts] = await Promise.all([
    esummary(pmids),
    efetchAbstracts(pmids),
  ]);

  return summaries.map((s, i) => {
    const paper = summaryToCandidatePaper(s, i);
    if (s.uid && abstracts[s.uid]) {
      paper.abstract = abstracts[s.uid] ?? null;
    }
    return paper;
  });
}

// ── E-utilities calls ─────────────────────────────────────────────

async function esearch(
  query: string,
  limit: number,
  yearRange?: { start?: number; end?: number },
): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("db", "pubmed");
  params.set("term", query);
  params.set("retmax", String(Math.min(limit, 200)));
  params.set("retmode", "json");
  params.set("sort", "relevance");

  if (yearRange?.start) params.set("mindate", `${yearRange.start}/01/01`);
  if (yearRange?.end) params.set("maxdate", `${yearRange.end}/12/31`);
  if (yearRange?.start || yearRange?.end) params.set("datetype", "pdat");

  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) params.set("api_key", apiKey);

  const url = `${ESEARCH}?${params.toString()}`;
  const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`PubMed esearch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as ESearchResult;
  return data.esearchresult?.idlist ?? [];
}

interface ESearchResult {
  esearchresult?: {
    idlist?: string[];
    count?: string;
  };
}

async function esummary(pmids: string[]): Promise<PubMedSummary[]> {
  const params = new URLSearchParams();
  params.set("db", "pubmed");
  params.set("id", pmids.join(","));
  params.set("retmode", "json");

  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) params.set("api_key", apiKey);

  const url = `${ESUMMARY}?${params.toString()}`;
  const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`PubMed esummary failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as ESummaryResult;
  const result = data.result;
  if (!result) return [];

  const summaries: PubMedSummary[] = [];
  for (const pmid of pmids) {
    const doc = result[pmid];
    if (doc && typeof doc === "object" && "uid" in doc) {
      summaries.push(doc as PubMedSummary);
    }
  }
  return summaries;
}

async function efetchAbstracts(pmids: string[]): Promise<Record<string, string>> {
  const params = new URLSearchParams();
  params.set("db", "pubmed");
  params.set("id", pmids.join(","));
  params.set("retmode", "xml");
  params.set("rettype", "abstract");

  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) params.set("api_key", apiKey);

  const url = `${EFETCH}?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    return {};
  }

  const xml = await res.text();
  const abstracts: Record<string, string> = {};

  // Simple regex parsing of PubMed XML to extract abstract
  const articleRegex = /<PubmedArticle>(.*?)<\/PubmedArticle>/gs;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const articleXml = match[1];
    const pmidMatch = /<PMID[^>]*>(\d+)<\/PMID>/.exec(articleXml);
    if (!pmidMatch) continue;
    
    const pmid = pmidMatch[1];
    const abstractVals: string[] = [];
    
    const abstractMatch = /<Abstract>(.*?)<\/Abstract>/s.exec(articleXml);
    if (abstractMatch) {
      const textRegex = /<AbstractText[^>]*>(.*?)<\/AbstractText>/gs;
      let textMatch;
      while ((textMatch = textRegex.exec(abstractMatch[1])) !== null) {
        abstractVals.push(textMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim());
      }
    }
    
    if (abstractVals.length > 0) {
      abstracts[pmid] = abstractVals.join("\n\n");
    }
  }
  
  return abstracts;
}

interface ESummaryResult {
  result?: Record<string, unknown>;
}

interface PubMedAuthor {
  name: string;
  authtype?: string;
}

interface PubMedArticleId {
  idtype: string;
  value: string;
}

interface PubMedSummary {
  uid: string;
  title: string;
  authors?: PubMedAuthor[];
  source?: string; // journal abbreviation
  fulljournalname?: string;
  pubdate?: string;
  elocationid?: string; // e.g. "doi: 10.1234/..."
  articleids?: PubMedArticleId[];
  pubtype?: string[];
  issn?: string;
}

// ── Mapping ───────────────────────────────────────────────────────

function summaryToCandidatePaper(s: PubMedSummary, rank: number): CandidatePaper {
  // Extract DOI from articleids or elocationid
  let doi: string | null = null;
  if (s.articleids) {
    const doiEntry = s.articleids.find((a) => a.idtype === "doi");
    if (doiEntry) doi = doiEntry.value;
  }
  if (!doi && s.elocationid?.startsWith("doi:")) {
    doi = s.elocationid.replace(/^doi:\s*/, "").trim();
  }

  // Parse year from pubdate
  let year: number | null = null;
  if (s.pubdate) {
    const m = s.pubdate.match(/(\d{4})/);
    if (m) year = parseInt(m[1], 10);
  }

  const authors = (s.authors ?? []).map((a) => a.name);

  return {
    doi,
    title: s.title?.replace(/<\/?[^>]+>/g, "") ?? "Untitled",
    authors,
    venue: s.fulljournalname ?? s.source ?? null,
    year,
    abstract: null, // esummary doesn't return abstracts; efetch would be needed
    source: "pubmed",
    source_rank: rank,
    publisher_hint: null,
    open_access_hint: null,
    landing_page_url: `https://pubmed.ncbi.nlm.nih.gov/${s.uid}/`,
  };
}

