import { describe, it, expect } from "vitest";
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { handleSearchPapers, handleSearchSingleSource } from "../src/tools/handlers/discovery.js";
import { handleFetchFulltext } from "../src/tools/handlers/retrieval.js";

describe("Comprehensive API Provider Tests", () => {
  const config = loadConfig();
  
  // Enable all sources for testing
  const testConfig = { 
    ...config, 
    discovery: { 
      openalex: true, crossref: true, scopus: true, 
      springer_meta: true, arxiv: true, pubmed: true, 
      europe_pmc: true, semantic_scholar: true, unpaywall: true 
    },
    retrieval: {
      elsevier_api: true, springer_oa_api: true, wiley_tdm: true, 
      europe_pmc_fulltext: true, browser_assisted: false, manual_import: false
    }
  };

  it("should search ArXiv", async () => {
    const res = await handleSearchSingleSource({ source: "arxiv", query: "transformer" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers.length).toBeGreaterThan(0);
  }, 15000);

  it("should search Springer Meta", async () => {
    const res = await handleSearchSingleSource({ source: "springer_meta", query: "machine learning" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers.length).toBeGreaterThan(0);
  }, 15000);

  it("should search PubMed", async () => {
    const res = await handleSearchSingleSource({ source: "pubmed", query: "cancer" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers.length).toBeGreaterThan(0);
  }, 15000);

  // Note: Scopus requires ELSEVIER_API_KEY
  it("should search Scopus", async () => {
    const res = await handleSearchSingleSource({ source: "scopus", query: "quantum computing" }, testConfig);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers).toBeDefined();
  }, 15000);

  // Testing Fulltext Retrieval from Elsevier, Springer, Europe PMC via handleFetchFulltext
  it("should attempt fulltext retrieval (Europe PMC Open Access)", async () => {
    // A known OA article from Europe PMC: PMCID PMC8021316 (DOI 10.1038/s41586-021-03352-0 - alphafold) or another known OA
    // Let's use a very common OA paper DOI for testing Europe PMC: 10.1371/journal.pbio.1002333
    const plan = {
      doi: "10.1371/journal.pbio.1002333",
      preferred_route: "europe_pmc" as const, // Forcing open acess
      alternative_routes: []
    };
    const res = await handleFetchFulltext({ plan }, testConfig);
    if (res.isError) {
      console.error(res.content[0].text);
    }
    // As long as it doesn't crash, the network logic works.
    expect(res.isError).toBeFalsy();
  }, 30000);
});
