/**
 * Local storage adapter.
 * Manages the local cache, corpus, and artifact storage.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { doiToSafePath } from "../../utils/doi.js";

// ── Cache operations ──────────────────────────────────────────────

export interface CacheEntry {
  doi: string;
  path: string;
  artifact_type: string | null;
  cached_at: string;
}

export function checkCache(
  doi: string,
  cacheDir: string = "./cache",
): { found: boolean; path: string | null; entry: CacheEntry | null } {
  const safeDoi = doiToSafePath(doi);
  const dir = resolve(cacheDir, safeDoi);
  if (existsSync(dir)) {
    // Try to read the metadata file
    const metaPath = join(dir, "meta.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as CacheEntry;
        return { found: true, path: dir, entry: meta };
      } catch {
        // meta.json exists but is corrupted
      }
    }
    return {
      found: true,
      path: dir,
      entry: { doi, path: dir, artifact_type: null, cached_at: "unknown" },
    };
  }
  return { found: false, path: null, entry: null };
}

/**
 * Store an artifact in the local cache.
 */
export function cacheArtifact(
  doi: string,
  artifactPath: string,
  artifactType: string,
  cacheDir: string = "./cache",
): CacheEntry {
  const safeDoi = doiToSafePath(doi);
  const dir = resolve(cacheDir, safeDoi);
  mkdirSync(dir, { recursive: true });

  const entry: CacheEntry = {
    doi,
    path: dir,
    artifact_type: artifactType,
    cached_at: new Date().toISOString(),
  };

  writeFileSync(join(dir, "meta.json"), JSON.stringify(entry, null, 2));

  return entry;
}

// ── Corpus operations ─────────────────────────────────────────────

export interface CorpusIndex {
  name: string;
  papers: CorpusPaperRef[];
  created_at: string;
  updated_at: string;
}

export interface CorpusPaperRef {
  paper_id: string;
  doi: string | null;
  title: string;
  added_at: string;
}

function corpusDir(basePath: string = "./corpus"): string {
  return resolve(basePath);
}

function corpusIndexPath(name: string, basePath?: string): string {
  return join(corpusDir(basePath), `${name}.json`);
}

/**
 * Load or create a corpus index file.
 */
function loadCorpus(name: string, basePath?: string): CorpusIndex {
  const p = corpusIndexPath(name, basePath);
  if (existsSync(p)) {
    return JSON.parse(readFileSync(p, "utf-8")) as CorpusIndex;
  }
  return {
    name,
    papers: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function saveCorpus(corpus: CorpusIndex, basePath?: string): void {
  const dir = corpusDir(basePath);
  mkdirSync(dir, { recursive: true });
  corpus.updated_at = new Date().toISOString();
  writeFileSync(corpusIndexPath(corpus.name, basePath), JSON.stringify(corpus, null, 2));
}

/**
 * Add a paper to a named corpus.
 */
export function addToCorpus(
  corpusName: string,
  paperId: string,
  doi: string | null,
  title: string,
  basePath?: string,
): CorpusIndex {
  const corpus = loadCorpus(corpusName, basePath);
  // Avoid duplicates
  if (corpus.papers.some((p) => p.paper_id === paperId)) {
    return corpus;
  }
  corpus.papers.push({
    paper_id: paperId,
    doi,
    title,
    added_at: new Date().toISOString(),
  });
  saveCorpus(corpus, basePath);
  return corpus;
}

/**
 * List all papers in a corpus.
 */
export function listCorpus(corpusName: string, basePath?: string): CorpusPaperRef[] {
  return loadCorpus(corpusName, basePath).papers;
}

/**
 * Remove a paper from a corpus.
 */
export function removeFromCorpus(
  corpusName: string,
  paperId: string,
  basePath?: string,
): CorpusIndex {
  const corpus = loadCorpus(corpusName, basePath);
  corpus.papers = corpus.papers.filter((p) => p.paper_id !== paperId);
  saveCorpus(corpus, basePath);
  return corpus;
}

/**
 * Deduplicate corpus entries by DOI.
 */
export function deduplicateCorpus(corpusName: string, basePath?: string): CorpusIndex {
  const corpus = loadCorpus(corpusName, basePath);
  const seen = new Set<string>();
  corpus.papers = corpus.papers.filter((p) => {
    const key = p.doi ?? p.paper_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  saveCorpus(corpus, basePath);
  return corpus;
}

/**
 * List all available corpus names.
 */
export function listAllCorpora(basePath?: string): string[] {
  const dir = corpusDir(basePath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}
