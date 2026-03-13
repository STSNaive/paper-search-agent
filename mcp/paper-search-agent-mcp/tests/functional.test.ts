import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { handleSearchPapers } from "../src/tools/handlers/discovery.js";
import { handleManageCorpus } from "../src/tools/handlers/storage.js";
import { parsePaper } from "../src/adapters/parsing/paper-parser.js";

describe("Full Functional Integration Pipeline", () => {
  const config = loadConfig();
  // Enable semantic scholar, openalex, crossref for tests
  const testConfig = { 
    ...config, 
    discovery: { ...config.discovery, semantic_scholar: true, openalex: true, crossref: true }
  };

  let testPaper: any;

  it("should successfully search papers across multiple sources", async () => {
    const searchArgs = {
      query: "attention is all you need",
      limit: 3,
      sources: ["openalex", "crossref", "semantic_scholar"],
    };
    const res = await handleSearchPapers(searchArgs, testConfig);
    
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text as string);
    expect(data.papers.length).toBeGreaterThan(0);
    expect(data.papers[0].title).toBeDefined();
    
    // Save the first paper for later tests
    testPaper = data.papers[0];
  }, 20000); // 20s timeout for network requests

  it("should successfully add a paper to a corpus", async () => {
    expect(testPaper).toBeDefined();
    const addRes = await handleManageCorpus({ action: "add", corpus_name: "test-corpus", paper_id: testPaper.title, title: testPaper.title, doi: testPaper.doi }, testConfig);
    expect(addRes.isError).toBeFalsy();
    const addData = JSON.parse(addRes.content[0].text as string);
    expect(addData.action).toBe("added");
    expect(addData.corpus).toBeDefined();
  });

  it("should list all corpora", async () => {
    const listRes = await handleManageCorpus({ action: "list_all" }, testConfig);
    expect(listRes.isError).toBeFalsy();
    const listData = JSON.parse(listRes.content[0].text as string);
    expect(listData.corpora).toContain("test-corpus");
  });

  it("should list papers in a specific corpus", async () => {
    const corpusRes = await handleManageCorpus({ action: "list", corpus_name: "test-corpus" }, testConfig);
    expect(corpusRes.isError).toBeFalsy();
    const corpusData = JSON.parse(corpusRes.content[0].text as string);
    expect(corpusData.papers.length).toBeGreaterThan(0);
    expect(corpusData.papers.some((p: any) => p.title === testPaper.title)).toBeTruthy();
  });
});
