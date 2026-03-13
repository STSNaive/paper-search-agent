/**
 * Configuration reader for paper-search-agent.
 * Reads config.toml and exposes typed switches for discovery sources,
 * retrieval routes, and optional integrations.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml } from "toml";

// ── Section interfaces ────────────────────────────────────────────

export interface PathConfig {
  cache_dir: string;
  corpus_dir: string;
}

export interface DiscoveryConfig {
  openalex: boolean;
  crossref: boolean;
  scopus: boolean;
  springer_meta: boolean;
  arxiv: boolean;
  pubmed: boolean;
  europe_pmc: boolean;
  semantic_scholar: boolean;
  unpaywall: boolean;
}

export interface RetrievalConfig {
  elsevier_api: boolean;
  springer_oa_api: boolean;
  wiley_tdm: boolean;
  europe_pmc_fulltext: boolean;
  browser_assisted: boolean;
  manual_import: boolean;
}

export interface IntegrationsConfig {
  zotero: boolean;
}

export interface BrowserConfig {
  auto_save_state: boolean;
  state_directory: string;
}

export interface TokenBudgetConfig {
  abstract_first_triage: boolean;
  max_fulltext_tokens: number;
}

export interface AppConfig {
  discovery: DiscoveryConfig;
  retrieval: RetrievalConfig;
  integrations: IntegrationsConfig;
  browser: BrowserConfig;
  token_budget: TokenBudgetConfig;
  paths: PathConfig;
}

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULTS: AppConfig = {
  paths: {
    cache_dir: "./cache",
    corpus_dir: "./corpus",
  },
  discovery: {
    openalex: true,
    crossref: true,
    scopus: false,
    springer_meta: true,
    arxiv: false,
    pubmed: false,
    europe_pmc: true,
    semantic_scholar: false,
    unpaywall: true,
  },
  retrieval: {
    elsevier_api: true,
    springer_oa_api: true,
    wiley_tdm: false,
    europe_pmc_fulltext: true,
    browser_assisted: true,
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
};

// ── Loader ────────────────────────────────────────────────────────

/**
 * Load configuration from config.toml, falling back to defaults for
 * any missing section or key.
 */
export function loadConfig(configPath?: string): AppConfig {
  // Prefer local config in MCP project dir, fall back to project root
  const resolvedPath = configPath
    ?? (existsSync(resolve(process.cwd(), "config.toml"))
      ? resolve(process.cwd(), "config.toml")
      : resolve(process.cwd(), "../../config.toml"));
  let raw: Record<string, unknown> = {};

  try {
    const content = readFileSync(resolvedPath, "utf-8");
    raw = parseToml(content) as Record<string, unknown>;
  } catch {
    // Config file missing or unreadable �?use defaults
  }

  return {
    discovery: { ...DEFAULTS.discovery, ...(raw.discovery as Partial<DiscoveryConfig>) },
    retrieval: { ...DEFAULTS.retrieval, ...(raw.retrieval as Partial<RetrievalConfig>) },
    integrations: { ...DEFAULTS.integrations, ...(raw.integrations as Partial<IntegrationsConfig>) },
    browser: { ...DEFAULTS.browser, ...(raw.browser as Partial<BrowserConfig>) },
    token_budget: { ...DEFAULTS.token_budget, ...(raw.token_budget as Partial<TokenBudgetConfig>) },
    paths: { ...DEFAULTS.paths, ...(raw.paths as Partial<PathConfig>) },
  };
}

// ── Helpers ───────────────────────────────────────────────────────

/** Return the list of enabled discovery source names. */
export function enabledDiscoverySources(config: AppConfig): string[] {
  return Object.entries(config.discovery)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

/**
 * Return the subset of enabled discovery sources that support keyword search.
 * Unpaywall is DOI lookup only, so it should not be exposed via search tools.
 */
export function enabledSearchDiscoverySources(config: AppConfig): string[] {
  return enabledDiscoverySources(config).filter((name) => name !== "unpaywall");
}

/** Return the list of enabled retrieval route names. */
export function enabledRetrievalRoutes(config: AppConfig): string[] {
  return Object.entries(config.retrieval)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

