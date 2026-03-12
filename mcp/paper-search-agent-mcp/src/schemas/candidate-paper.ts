/**
 * CandidatePaper — a discovered paper with metadata and OA hints.
 * Produced by discovery tools, consumed by the access planner.
 */
export interface CandidatePaper {
  /** Canonical identifier — DOI preferred */
  doi: string | null;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  abstract: string | null;
  /** Which discovery source found this paper */
  source: string;
  /** Source-specific relevance rank (lower = more relevant) */
  source_rank: number | null;
  /** Inferred publisher (e.g., "elsevier", "springer", "wiley") */
  publisher_hint: string | null;
  /** Whether the paper appears to be open access */
  open_access_hint: boolean | null;
  /** Landing page URL for browser-based retrieval */
  landing_page_url: string | null;
}

/**
 * DiscoveryResult — aggregated output from one or more discovery sources.
 */
export interface DiscoveryResult {
  query: string;
  sources_queried: string[];
  total_results: number;
  candidates: CandidatePaper[];
  deduplicated: boolean;
}
