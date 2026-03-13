import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { handleFetchFulltext, handleImportLocalFile } from "../src/tools/handlers/retrieval.js";

const tempDirs: string[] = [];

function makeConfig(baseDir: string): AppConfig {
  return {
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
    integrations: { zotero: false },
    browser: {
      auto_save_state: true,
      state_directory: join(baseDir, "browser-state"),
    },
    token_budget: {
      abstract_first_triage: true,
      max_fulltext_tokens: 60_000,
    },
    paths: {
      cache_dir: join(baseDir, "cache"),
      corpus_dir: join(baseDir, "corpus"),
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("retrieval handler regressions", () => {
  it("imports a local file without using CommonJS require", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "psa-import-"));
    tempDirs.push(baseDir);

    const config = makeConfig(baseDir);
    const sourceFile = join(baseDir, "sample.txt");
    writeFileSync(sourceFile, "Sample imported text for regression coverage.", "utf-8");

    const result = await handleImportLocalFile({ file_path: sourceFile, title: "Sample" }, config);
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("imported");
    expect(existsSync(payload.file_path)).toBe(true);
    expect(payload.parsed_summary.extracted_text_length).toBeGreaterThan(0);
  });

  it("parses a cached artifact file instead of treating the cache directory as the artifact", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "psa-cache-"));
    tempDirs.push(baseDir);

    const config = makeConfig(baseDir);
    const paperDir = join(config.paths.cache_dir, "10.1000_test");
    mkdirSync(paperDir, { recursive: true });

    const artifactPath = join(paperDir, "fulltext.xml");
    writeFileSync(
      artifactPath,
      '<article><front><article-meta><article-title>Cached Paper</article-title></article-meta></front><body><sec><title>Introduction</title><p>Hello cached world.</p></sec></body></article>',
      "utf-8",
    );
    writeFileSync(
      join(paperDir, "meta.json"),
      JSON.stringify({ doi: "10.1000/test", path: artifactPath, artifact_type: "xml", cached_at: new Date().toISOString() }),
      "utf-8",
    );

    const plan = {
      paper_id: "10.1000_test",
      doi: "10.1000/test",
      publisher: null,
      preferred_route: "local_cache" as const,
      alternative_routes: ["manual_import_pdf" as const],
      entitlement_state: { local_cache: "confirmed" as const },
      required_env: {},
      expected_output: "xml" as const,
      compliance_constraints: [],
      notes: "",
    };

    const result = await handleFetchFulltext({ plan }, config);
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.status).toBe("success");
    expect(payload.retrieval.artifact_path).toBe(artifactPath);
    expect(payload.parsed_summary.sections_found).toContain("introduction");
  });
});
