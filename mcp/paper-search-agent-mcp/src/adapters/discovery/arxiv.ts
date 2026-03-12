/**
 * arXiv discovery adapter.
 * Uses the arXiv API (Atom feed) to search for papers.
 * Docs: https://info.arxiv.org/help/api/basics.html
 */

import type { CandidatePaper } from "../../schemas/index.js";

const BASE = "https://export.arxiv.org/api/query";

/**
 * Search arXiv by keyword / query string.
 */
export async function searchArxiv(
  query: string,
  limit: number = 20,
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const params = new URLSearchParams();
  params.set("search_query", `all:${query}`);
  params.set("max_results", String(Math.min(limit, 200)));
  params.set("sortBy", "relevance");
  params.set("sortOrder", "descending");

  const url = `${BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/atom+xml" },
  });
  if (!res.ok) {
    throw new Error(`arXiv search failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const entries = parseAtomEntries(xml);

  // Filter by year range if specified
  let filtered = entries;
  if (yearRange?.start || yearRange?.end) {
    filtered = entries.filter((e) => {
      if (!e.year) return true;
      if (yearRange.start && e.year < yearRange.start) return false;
      if (yearRange.end && e.year > yearRange.end) return false;
      return true;
    });
  }

  return filtered.map((e, i) => entryToCandidatePaper(e, i));
}

// ── Atom XML parsing ──────────────────────────────────────────────

interface ArxivEntry {
  id: string; // arXiv URL like http://arxiv.org/abs/2301.12345v1
  title: string;
  authors: string[];
  summary: string;
  published: string;
  year: number | null;
  doi: string | null;
  categories: string[];
  pdfLink: string | null;
}

function parseAtomEntries(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];

  // Split by <entry> tags
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    const id = extractTag(block, "id") ?? "";
    const title = (extractTag(block, "title") ?? "").replace(/\s+/g, " ").trim();
    const summary = (extractTag(block, "summary") ?? "").replace(/\s+/g, " ").trim();
    const published = extractTag(block, "published") ?? "";
    const doi = extractDoi(block);

    // Parse authors: <author><name>...</name></author>
    const authors: string[] = [];
    const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>/g;
    let am;
    while ((am = authorRegex.exec(block)) !== null) {
      authors.push(am[1].trim());
    }

    // Parse categories
    const categories: string[] = [];
    const catRegex = /<category[^>]*term="([^"]+)"/g;
    let cm;
    while ((cm = catRegex.exec(block)) !== null) {
      categories.push(cm[1]);
    }

    // PDF link
    const pdfMatch = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
    const pdfLink = pdfMatch ? pdfMatch[1] : null;

    const year = published ? parseInt(published.slice(0, 4), 10) || null : null;

    entries.push({ id, title, authors, summary, published, year, doi, categories, pdfLink });
  }

  return entries;
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : null;
}

function extractDoi(block: string): string | null {
  // arXiv may include <arxiv:doi> or <doi> tags
  const m = block.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/);
  if (m) return m[1].trim();
  const m2 = block.match(/<doi[^>]*>([\s\S]*?)<\/doi>/);
  return m2 ? m2[1].trim() : null;
}

function entryToCandidatePaper(entry: ArxivEntry, rank: number): CandidatePaper {
  // Extract arXiv ID from URL: http://arxiv.org/abs/2301.12345v1 -> 2301.12345
  const arxivId = entry.id.replace(/.*\/abs\//, "").replace(/v\d+$/, "");

  return {
    doi: entry.doi,
    title: entry.title,
    authors: entry.authors,
    venue: `arXiv:${arxivId}`,
    year: entry.year,
    abstract: entry.summary || null,
    source: "arxiv",
    source_rank: rank,
    publisher_hint: "arxiv",
    open_access_hint: true, // arXiv is always OA
    landing_page_url: entry.id,
  };
}
