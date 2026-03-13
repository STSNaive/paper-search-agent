import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";

vi.mock("../src/adapters/publishers/europe-pmc.js", () => ({
  searchEuropePmc: vi.fn(async () => ([
    {
      doi: "10.1000/europe-pmc",
      title: "Europe PMC Result",
      authors: ["Example Author"],
      venue: "PMC Journal",
      year: 2024,
      abstract: "Mocked Europe PMC result",
      source: "europe_pmc",
      source_rank: 0,
      publisher_hint: null,
      open_access_hint: true,
      landing_page_url: "https://doi.org/10.1000/europe-pmc",
    },
  ])),
}));

import { searchConcurrent } from "../src/adapters/discovery/search-hub.js";
import { getToolDefinitions } from "../src/tools/definitions.js";

const config: AppConfig = {
  discovery: {
    openalex: false,
    crossref: false,
    scopus: false,
    springer_meta: false,
    arxiv: false,
    pubmed: false,
    europe_pmc: true,
    semantic_scholar: false,
    unpaywall: true,
  },
  retrieval: {
    elsevier_api: false,
    springer_oa_api: false,
    wiley_tdm: false,
    europe_pmc_fulltext: true,
    browser_assisted: false,
    manual_import: true,
  },
  integrations: { zotero: false },
  browser: {
    auto_save_state: true,
    state_directory: "./cache/browser-state",
  },
  token_budget: {
    abstract_first_triage: true,
    max_fulltext_tokens: 60_000,
  },
  paths: {
    cache_dir: "./cache",
    corpus_dir: "./corpus",
  },
};

describe("search hub wiring", () => {
  it("routes Europe PMC search through the search hub", async () => {
    const results = await searchConcurrent(config, "cancer", 5, ["europe_pmc"]);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("europe_pmc");
  });

  it("does not expose DOI-only Unpaywall as a keyword search source", () => {
    const definitions = getToolDefinitions(config);
    const searchSingle = definitions.find((tool) => tool.name === "search_single_source");
    expect(searchSingle).toBeDefined();

    const sourceEnum = ((searchSingle as any).inputSchema.properties.source.enum ?? []) as string[];
    expect(sourceEnum).toContain("europe_pmc");
    expect(sourceEnum).not.toContain("unpaywall");
  });
});
