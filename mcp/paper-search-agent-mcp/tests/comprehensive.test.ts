import { describe, it, expect } from "vitest";
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { handleSearchPapers, handleSearchSingleSource } from "../src/tools/handlers/discovery.js";
import { handleFetchFulltext } from "../src/tools/handlers/retrieval.js";

const liveIt = process.env.RUN_LIVE_API_TESTS === "1" ? it : it.skip;

describe("Comprehensive API Provider Tests", () => {
  const config = loadConfig();

  // These are live network smoke tests. Keep them opt-in so the default suite
  // remains deterministic and does not depend on third-party API availability.
  const testConfig = {
    ...config,
    discovery: {
      openalex: true,
      crossref: true,
      scopus: true,
      springer_meta: true,
      arxiv: true,
      pubmed: true,
      europe_pmc: true,
      semantic_scholar: true,
      unpaywall: true,
    },
    retrieval: {
      elsevier_api: true,
      springer_oa_api: true,
      wiley_tdm: true,
      europe_pmc_fulltext: true,
      browser_assisted: false,
      manual_import: false,
    },
  };

  liveIt("should search ArXiv", async () => {
    const res = await handleSearchSingleSource({ source: "arxiv", query: "transformer" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers.length).toBeGreaterThan(0);
  }, 15000);

  liveIt("should search Springer Meta", async () => {
    const res = await handleSearchSingleSource({ source: "springer_meta", query: "machine learning" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers.length).toBeGreaterThan(0);
  }, 15000);

  liveIt("should search PubMed", async () => {
    const res = await handleSearchSingleSource({ source: "pubmed", query: "cancer" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers.length).toBeGreaterThan(0);
  }, 20000);

  liveIt("should search Scopus", async () => {
    const res = await handleSearchSingleSource({ source: "scopus", query: "quantum computing" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers).toBeDefined();
  }, 15000);

  liveIt("should attempt fulltext retrieval (Europe PMC Open Access)", async () => {
    const plan = {
      doi: "10.1371/journal.pbio.1002333",
      preferred_route: "europe_pmc_fulltext" as const,
      alternative_routes: [],
    };
    const res = await handleFetchFulltext({ plan }, testConfig);
    expect(res.isError).toBeFalsy();
  }, 30000);

  liveIt("should search papers across multiple sources", async () => {
    const res = await handleSearchPapers({ query: "attention is all you need", limit: 3 }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(Array.isArray(data.papers)).toBe(true);
  }, 20000);
});
