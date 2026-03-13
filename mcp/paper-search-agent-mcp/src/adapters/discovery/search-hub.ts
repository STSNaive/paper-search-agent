import { CandidatePaper } from "../../schemas/index.js";
import { AppConfig, enabledDiscoverySources } from "../../config.js";
import { deduplicateCandidates } from "../../utils/dedup.js";

import { searchCrossref } from "./crossref.js";
import { searchOpenAlex } from "./openalex.js";
import { searchScopus } from "./scopus.js";
import { searchPubMed } from "./pubmed.js";
import { searchSpringerMeta } from "./springer-meta.js";
import { searchArxiv } from "./arxiv.js";
import { searchSemanticScholar } from "./semantic-scholar.js";

export async function searchConcurrent(
  config: AppConfig,
  query: string,
  limit: number,
  requestedSources?: string[],
  yearRange?: { start?: number; end?: number }
): Promise<CandidatePaper[]> {
  const allEnabled = enabledDiscoverySources(config);
  const sources = requestedSources 
    ? requestedSources.filter(s => allEnabled.includes(s))
    : allEnabled;

  if (sources.length === 0) {
    throw new Error("No valid, enabled discovery sources specified.");
  }

  const tasks: Promise<void>[] = [];
  const allCandidates: CandidatePaper[] = [];
  const errors: Record<string, string> = {};

  if (sources.includes("crossref")) {
    tasks.push(
      searchCrossref(query, limit, yearRange)
        .then(res => { allCandidates.push(...res); })
        .catch(e => { errors.crossref = e.message; })
    );
  }
  if (sources.includes("openalex")) {
    tasks.push(
      searchOpenAlex(query, limit, yearRange)
        .then(res => { allCandidates.push(...res); })
        .catch(e => { errors.openalex = e.message; })
    );
  }
  if (sources.includes("scopus")) {
    // Scopus requires API key from config/env, our adapter implicitly expects it
    tasks.push(
      searchScopus(query, limit, yearRange)
        .then(res => { allCandidates.push(...res); })
        .catch(e => { errors.scopus = e.message; })
    );
  }
  if (sources.includes("pubmed")) {
    tasks.push(
      searchPubMed(query, limit, yearRange)
        .then(res => { allCandidates.push(...res); })
        .catch(e => { errors.pubmed = e.message; })
    );
  }
  if (sources.includes("springer_meta")) {
    tasks.push(
      searchSpringerMeta(query, limit, yearRange)
        .then(res => { allCandidates.push(...res); })
        .catch(e => { errors.springer_meta = e.message; })
    );
  }
  if (sources.includes("arxiv")) {
    tasks.push(
      searchArxiv(query, limit, yearRange)
        .then(res => { allCandidates.push(...res); })
        .catch(e => { errors.arxiv = e.message; })
    );
  }
  if (sources.includes("semantic_scholar")) {
    tasks.push(
      searchSemanticScholar(query, limit, yearRange)
        .then(res => { allCandidates.push(...res); })
        .catch(e => { errors.semantic_scholar = e.message; })
    );
  }

  await Promise.allSettled(tasks);

  if (Object.keys(errors).length > 0) {
    console.error("Some search sources failed:", errors);
  }

  return allCandidates;
}
