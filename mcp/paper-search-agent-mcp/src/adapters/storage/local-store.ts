/**
 * Local storage adapter.
 * Manages the local cache, corpus, and artifact storage.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { doiToSafePath } from "../../utils/doi.js";
import type { NormalizedPaperRecord } from "../../schemas/index.js";

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
  if (!existsSync(dir)) {
    return { found: false, path: null, entry: null };
  }

  let entry: CacheEntry | null = null;
  const metaPath = join(dir, "meta.json");
  if (existsSync(metaPath)) {
    try {
      entry = JSON.parse(readFileSync(metaPath, "utf-8")) as CacheEntry;
    } catch {
      entry = null;
    }
  }

  const artifactPath = resolveCachedArtifactPath(dir, entry?.artifact_type ?? null, entry?.path ?? null);
  if (!artifactPath) {
    return { found: false, path: null, entry };
  }

  const resolvedEntry: CacheEntry = entry
    ? { ...entry, path: artifactPath }
    : {
        doi,
        path: artifactPath,
        artifact_type: inferArtifactTypeFromPath(artifactPath),
        cached_at: "unknown",
      };

  return { found: true, path: artifactPath, entry: resolvedEntry };
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
    path: resolve(artifactPath),
    artifact_type: artifactType,
    cached_at: new Date().toISOString(),
  };

  writeFileSync(join(dir, "meta.json"), JSON.stringify(entry, null, 2));

  return entry;
}

function resolveCachedArtifactPath(
  dir: string,
  artifactType: string | null,
  storedPath: string | null,
): string | null {
  const candidates = new Set<string>();

  if (storedPath) {
    candidates.add(resolve(storedPath));
  }

  const normalizedType = artifactType?.toLowerCase() ?? null;
  if (normalizedType) {
    const extension = normalizedType === "text" ? "txt" : normalizedType;
    candidates.add(join(dir, `fulltext.${extension}`));
  }

  for (const defaultPath of ["fulltext.xml", "fulltext.html", "fulltext.pdf", "fulltext.txt"]) {
    candidates.add(join(dir, defaultPath));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  for (const fileName of readdirSync(dir)) {
    if (fileName === "meta.json") continue;
    const candidate = join(dir, fileName);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function inferArtifactTypeFromPath(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "text";
  return null;
}

function parsedDir(basePath: string): string {
  return resolve(basePath, "_parsed");
}

export function saveParsedRecord(
  paperId: string,
  record: NormalizedPaperRecord,
  basePath: string,
): void {
  const safeName = paperId.replace(/[/\\:*?"<>|]/g, "_");
  const dir = parsedDir(basePath);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${safeName}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
}

export function loadParsedRecord(
  paperId: string,
  basePath: string,
): NormalizedPaperRecord | null {
  const safeName = paperId.replace(/[/\\:*?"<>|]/g, "_");
  const filePath = join(parsedDir(basePath), `${safeName}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as NormalizedPaperRecord;
}

export function loadAllParsedRecords(basePath: string): NormalizedPaperRecord[] {
  const dir = parsedDir(basePath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => JSON.parse(readFileSync(join(dir, fileName), "utf-8")) as NormalizedPaperRecord);
}

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

function corpusDir(basePath: string): string {
  return resolve(basePath);
}

function corpusIndexPath(name: string, basePath: string): string {
  return join(corpusDir(basePath), `${name}.json`);
}

function loadCorpus(name: string, basePath: string): CorpusIndex {
  const filePath = corpusIndexPath(name, basePath);
  if (existsSync(filePath)) {
    return JSON.parse(readFileSync(filePath, "utf-8")) as CorpusIndex;
  }
  return {
    name,
    papers: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function saveCorpus(corpus: CorpusIndex, basePath: string): void {
  const dir = corpusDir(basePath);
  mkdirSync(dir, { recursive: true });
  corpus.updated_at = new Date().toISOString();
  writeFileSync(corpusIndexPath(corpus.name, basePath), JSON.stringify(corpus, null, 2));
}

export function addToCorpus(
  corpusName: string,
  paperId: string,
  doi: string | null,
  title: string,
  basePath: string,
): CorpusIndex {
  const corpus = loadCorpus(corpusName, basePath);
  if (corpus.papers.some((paper) => paper.paper_id === paperId)) {
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

export function listCorpus(corpusName: string, basePath: string): CorpusPaperRef[] {
  return loadCorpus(corpusName, basePath).papers;
}

export function removeFromCorpus(
  corpusName: string,
  paperId: string,
  basePath: string,
): CorpusIndex {
  const corpus = loadCorpus(corpusName, basePath);
  corpus.papers = corpus.papers.filter((paper) => paper.paper_id !== paperId);
  saveCorpus(corpus, basePath);
  return corpus;
}

export function deduplicateCorpus(corpusName: string, basePath: string): CorpusIndex {
  const corpus = loadCorpus(corpusName, basePath);
  const seen = new Set<string>();
  corpus.papers = corpus.papers.filter((paper) => {
    const key = paper.doi ?? paper.paper_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  saveCorpus(corpus, basePath);
  return corpus;
}

export function listAllCorpora(basePath: string): string[] {
  if (!basePath) return [];
  const dir = corpusDir(basePath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => fileName.replace(".json", ""));
}
