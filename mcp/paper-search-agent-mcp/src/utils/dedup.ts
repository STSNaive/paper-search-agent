/**
 * De-duplication utility for candidate papers.
 * Merges results from multiple discovery sources by DOI or title similarity.
 */

import type { CandidatePaper } from "../schemas/index.js";

/**
 * De-duplicate an array of candidate papers.
 * Papers with the same DOI are merged (earlier entry wins).
 * Papers without DOI are kept unless titles match closely.
 */
export function deduplicateCandidates(
  candidates: CandidatePaper[],
): CandidatePaper[] {
  const seenDois = new Map<string, CandidatePaper>();
  const noDoi: CandidatePaper[] = [];

  for (const c of candidates) {
    if (c.doi) {
      const normalized = c.doi.toLowerCase();
      if (!seenDois.has(normalized)) {
        seenDois.set(normalized, c);
      } else {
        // Merge: keep better OA hint
        const existing = seenDois.get(normalized)!;
        if (c.open_access_hint && !existing.open_access_hint) {
          existing.open_access_hint = c.open_access_hint;
        }
        if (c.abstract && !existing.abstract) {
          existing.abstract = c.abstract;
        }
      }
    } else {
      // Check for near-duplicate titles
      const normTitle = normalizeTitle(c.title);
      const isDup = [...seenDois.values(), ...noDoi].some(
        (existing) => normalizeTitle(existing.title) === normTitle,
      );
      if (!isDup) {
        noDoi.push(c);
      }
    }
  }

  return [...seenDois.values(), ...noDoi];
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}
