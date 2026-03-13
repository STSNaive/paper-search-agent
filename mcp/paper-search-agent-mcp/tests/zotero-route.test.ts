import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";

vi.mock("../src/adapters/integrations/zotero.js", () => ({
  loadZoteroConfig: vi.fn(() => ({
    apiKey: "test-key",
    libraryId: "123",
    libraryType: "user",
  })),
  zoteroLookup: vi.fn(async () => ({
    found: true,
    items: [{ key: "ABC123", version: 1, itemType: "journalArticle", title: "Stored Paper" }],
    total_results: 1,
    has_pdf: true,
    pdf_attachment_key: "PDF123",
  })),
}));

import { fetchFulltext } from "../src/adapters/retrieval/fulltext-fetcher.js";

const config: AppConfig = {
  discovery: {
    openalex: false,
    crossref: false,
    scopus: false,
    springer_meta: false,
    arxiv: false,
    pubmed: false,
    europe_pmc: false,
    semantic_scholar: false,
    unpaywall: false,
  },
  retrieval: {
    elsevier_api: false,
    springer_oa_api: false,
    wiley_tdm: false,
    europe_pmc_fulltext: false,
    browser_assisted: false,
    manual_import: true,
  },
  integrations: { zotero: true },
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

describe("zotero retrieval route", () => {
  it("does not report success without a concrete local artifact path", async () => {
    const plan = {
      paper_id: "10.1000_zotero",
      doi: "10.1000/zotero",
      publisher: null,
      preferred_route: "zotero_existing" as const,
      alternative_routes: [],
      entitlement_state: { zotero_existing: "confirmed" as const },
      required_env: {},
      expected_output: "pdf" as const,
      compliance_constraints: [],
      notes: "",
    };

    const result = await fetchFulltext(plan, config, config.paths.cache_dir, "zotero_existing");
    expect(result.success).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].error).toContain("cannot provide a local artifact path");
  });
});
