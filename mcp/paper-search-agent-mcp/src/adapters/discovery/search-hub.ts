import { CandidatePaper } from "../../schemas/index.js";
import { AppConfig, enabledSearchDiscoverySources } from "../../config.js";

import { searchCrossref } from "./crossref.js";
import { searchOpenAlex } from "./openalex.js";
import { searchScopus } from "./scopus.js";
import { searchPubMed } from "./pubmed.js";
import { searchSpringerMeta } from "./springer-meta.js";
import { searchArxiv } from "./arxiv.js";
import { searchSemanticScholar } from "./semantic-scholar.js";
import { searchEuropePmc } from "../publishers/europe-pmc.js";

export async function searchConcurrent(
  config: AppConfig,
  query: string,
  limit: number,
  requestedSources?: string[],
  yearRange?: { start?: number; end?: number },
): Promise<CandidatePaper[]> {
  const allEnabled = enabledSearchDiscoverySources(config);
  const sources = requestedSources
    ? requestedSources.filter((source) => allEnabled.includes(source))
    : allEnabled;

  if (sources.length === 0) {
    throw new Error("No valid, enabled search-capable discovery sources specified.");
  }

  const tasks: Promise<void>[] = [];
  const allCandidates: CandidatePaper[] = [];
  const errors: Record<string, string> = {};

  if (sources.includes("crossref")) {
    tasks.push(
      searchCrossref(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.crossref = error.message; }),
    );
  }
  if (sources.includes("openalex")) {
    tasks.push(
      searchOpenAlex(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.openalex = error.message; }),
    );
  }
  if (sources.includes("scopus")) {
    tasks.push(
      searchScopus(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.scopus = error.message; }),
    );
  }
  if (sources.includes("pubmed")) {
    tasks.push(
      searchPubMed(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.pubmed = error.message; }),
    );
  }
  if (sources.includes("springer_meta")) {
    tasks.push(
      searchSpringerMeta(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.springer_meta = error.message; }),
    );
  }
  if (sources.includes("arxiv")) {
    tasks.push(
      searchArxiv(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.arxiv = error.message; }),
    );
  }
  if (sources.includes("semantic_scholar")) {
    tasks.push(
      searchSemanticScholar(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.semantic_scholar = error.message; }),
    );
  }
  if (sources.includes("europe_pmc")) {
    tasks.push(
      searchEuropePmc(query, limit, yearRange)
        .then((results) => { allCandidates.push(...results); })
        .catch((error: Error) => { errors.europe_pmc = error.message; }),
    );
  }

  if (tasks.length === 0) {
    throw new Error(`No search adapters are wired for the requested sources: ${sources.join(", ")}`);
  }

  await Promise.allSettled(tasks);

  if (Object.keys(errors).length > 0) {
    console.error("Some search sources failed:", errors);
  }

  return allCandidates;
}
