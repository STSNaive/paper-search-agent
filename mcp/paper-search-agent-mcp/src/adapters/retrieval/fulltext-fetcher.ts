/**
 * Full-text retrieval orchestrator.
 * Executes an AccessPlan's preferred route to download paper content.
 * Handles OA routes (OpenAlex PDF, Unpaywall PDF, Europe PMC XML)
 * and publisher API routes (Elsevier, Springer OA).
 */

import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import type { AccessPlan, RetrievalRoute, AccessAttempt } from "../../schemas/index.js";
import type { AppConfig } from "../../config.js";
import { doiToSafePath } from "../../utils/doi.js";
import { lookupOpenAlexByDoi } from "../discovery/openalex.js";
import { lookupUnpaywall } from "../discovery/unpaywall.js";
import { fetchEuropePmcFulltext, checkEuropePmcFulltext } from "../publishers/europe-pmc.js";
import { fetchElsevierFulltext } from "../publishers/elsevier.js";
import { browserRetrieve } from "../browser/playwright-retriever.js";
import { fetchWileyTdm } from "../publishers/wiley.js";
import { zoteroLookup, loadZoteroConfig } from "../integrations/zotero.js";
import { cacheArtifact } from "../storage/local-store.js";
import { logAttempts } from "../../utils/audit-log.js";
import { fetchWithRetry } from "../../utils/http.js";

export interface FetchResult {
  success: boolean;
  route_used: RetrievalRoute;
  artifact_path: string | null;
  artifact_type: "pdf" | "xml" | "html" | "text" | null;
  source_url: string | null;
  attempts: AccessAttempt[];
  error: string | null;
}

/**
 * Execute an AccessPlan to fetch full text.
 * Tries the preferred route first, then fallbacks in order.
 */
export async function fetchFulltext(
  plan: AccessPlan,
  config: AppConfig,
  cacheDir: string,
  routeOverride?: string,
): Promise<FetchResult> {
  const routes = routeOverride
    ? [routeOverride as RetrievalRoute]
    : [plan.preferred_route, ...plan.alternative_routes];

  const attempts: AccessAttempt[] = [];

  for (const route of routes) {
    const start = Date.now();
    try {
      const result = await executeRoute(route, plan, config, cacheDir);
      const attempt: AccessAttempt = {
        paper_id: plan.paper_id,
        doi: plan.doi,
        route,
        timestamp: new Date().toISOString(),
        success: result.success,
        status_code: result.success ? 200 : null,
        error: result.error,
        artifact_path: result.artifact_path,
        artifact_type: result.artifact_type,
        duration_ms: Date.now() - start,
        is_retry: attempts.length > 0,
        next_fallback: result.success ? null : routes[routes.indexOf(route) + 1] ?? null,
      };
      attempts.push(attempt);

      if (result.success) {
        // Cache the artifact
        if (plan.doi && result.artifact_path && result.artifact_type) {
          cacheArtifact(plan.doi, result.artifact_path, result.artifact_type, cacheDir);
        }

        logAttempts(attempts);
        return {
          success: true,
          route_used: route,
          artifact_path: result.artifact_path,
          artifact_type: result.artifact_type,
          source_url: result.source_url,
          attempts,
          error: null,
        };
      }
    } catch (e) {
      attempts.push({
        paper_id: plan.paper_id,
        doi: plan.doi,
        route,
        timestamp: new Date().toISOString(),
        success: false,
        status_code: null,
        error: (e as Error).message,
        artifact_path: null,
        artifact_type: null,
        duration_ms: Date.now() - start,
        is_retry: attempts.length > 0,
        next_fallback: routes[routes.indexOf(route) + 1] ?? null,
      });
    }
  }

  logAttempts(attempts);
  return {
    success: false,
    route_used: routes[routes.length - 1] ?? "manual_import_pdf",
    artifact_path: null,
    artifact_type: null,
    source_url: null,
    attempts,
    error: "All routes exhausted. Consider manual import.",
  };
}

interface RouteResult {
  success: boolean;
  artifact_path: string | null;
  artifact_type: "pdf" | "xml" | "html" | "text" | null;
  source_url: string | null;
  error: string | null;
}

async function executeRoute(
  route: RetrievalRoute,
  plan: AccessPlan,
  config: AppConfig,
  cacheDir: string,
): Promise<RouteResult> {
  switch (route) {
    case "local_cache":
      return executeLocalCache(plan, cacheDir);
    case "zotero_existing":
      return executeZoteroExisting(plan);
    case "oa_openalex":
      return executeOaOpenAlex(plan, cacheDir);
    case "oa_unpaywall":
      return executeOaUnpaywall(plan, cacheDir);
    case "europe_pmc_fulltext":
      return executeEuropePmc(plan, cacheDir);
    case "elsevier_api_fulltext":
      return executeElsevier(plan, cacheDir);
    case "springer_oa_api":
      return executeSpringerOa(plan, cacheDir);
    case "wiley_tdm_download":
      return executeWileyTdm(plan, cacheDir);
    case "manual_import_pdf":
      return {
        success: false,
        artifact_path: null,
        artifact_type: null,
        source_url: null,
        error: "Manual import requires user to provide a file via import_local_file.",
      };
    case "browser_download_pdf":
    case "browser_capture_html":
      return executeBrowserRoute(plan, cacheDir);
    default:
      return {
        success: false,
        artifact_path: null,
        artifact_type: null,
        source_url: null,
        error: `Route '${route}' not implemented.`,
      };
  }
}

function artifactDir(doi: string | null, cacheDir: string): string {
  const safeName = doi ? doiToSafePath(doi) : `paper_${Date.now()}`;
  const dir = resolve(cacheDir, safeName);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Route implementations ─────────────────────────────────────────

async function executeLocalCache(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI for cache lookup" };
  }
  const safeDoi = doiToSafePath(plan.doi);
  const dir = resolve(cacheDir, safeDoi);
  if (existsSync(dir)) {
    return {
      success: true,
      artifact_path: dir,
      artifact_type: plan.expected_output,
      source_url: null,
      error: null,
    };
  }
  return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "Cache miss" };
}

async function executeZoteroExisting(
  plan: AccessPlan,
): Promise<RouteResult> {
  const cfg = loadZoteroConfig();
  if (!cfg) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "Zotero not configured" };
  }
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI for Zotero lookup" };
  }

  const result = await zoteroLookup(cfg, { doi: plan.doi });
  if (!result.found) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "Paper not found in Zotero library" };
  }

  // Found the item — report it. Note: Zotero Web API doesn't provide
  // direct file download for PDF attachments without Zotero desktop.
  // We report the match so the user knows it's in their library.
  const itemKey = result.items[0]?.key;
  return {
    success: result.has_pdf,
    artifact_path: null,
    artifact_type: result.has_pdf ? "pdf" : null,
    source_url: `https://www.zotero.org/${cfg.libraryType}s/${cfg.libraryId}/items/${itemKey}`,
    error: result.has_pdf
      ? null
      : "Paper found in Zotero but no PDF attachment. Falling back to next route.",
  };
}

async function executeOaOpenAlex(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI" };
  }

  const oaInfo = await lookupOpenAlexByDoi(plan.doi);
  if (!oaInfo?.best_oa_url) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No OA URL from OpenAlex" };
  }

  return downloadPdf(oaInfo.best_oa_url, plan.doi, cacheDir);
}

async function executeOaUnpaywall(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI" };
  }

  const upResult = await lookupUnpaywall(plan.doi);
  if (!upResult.best_oa_url) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No OA URL from Unpaywall" };
  }

  return downloadPdf(upResult.best_oa_url, plan.doi, cacheDir);
}

async function executeEuropePmc(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI" };
  }

  // Find PMC ID first
  const check = await checkEuropePmcFulltext(plan.doi);
  if (!check.available || !check.pmcId) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "Not available in Europe PMC" };
  }

  const fulltext = await fetchEuropePmcFulltext(check.pmcId);
  if (!fulltext) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "Europe PMC returned no content" };
  }

  const dir = artifactDir(plan.doi, cacheDir);
  const xmlPath = join(dir, "fulltext.xml");
  writeFileSync(xmlPath, fulltext.xml, "utf-8");

  return {
    success: true,
    artifact_path: xmlPath,
    artifact_type: "xml",
    source_url: `https://europepmc.org/article/pmc/${check.pmcId}`,
    error: null,
  };
}

async function executeElsevier(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI" };
  }

  const apiKey = process.env.ELSEVIER_API_KEY;
  if (!apiKey) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "ELSEVIER_API_KEY not configured" };
  }

  const result = await fetchElsevierFulltext(plan.doi, apiKey);
  if (!result.success || !result.content) {
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      source_url: null,
      error: result.error ?? "Elsevier retrieval failed",
    };
  }

  const dir = artifactDir(plan.doi, cacheDir);
  const ext = result.content_type === "xml" ? "xml" : "txt";
  const filePath = join(dir, `fulltext.${ext}`);
  writeFileSync(filePath, result.content, "utf-8");

  return {
    success: true,
    artifact_path: filePath,
    artifact_type: result.content_type ?? "text",
    source_url: `https://api.elsevier.com/content/article/doi/${plan.doi}`,
    error: null,
  };
}

async function executeSpringerOa(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI" };
  }

  // Springer OA API uses a separate key from Meta API
  const apiKey = process.env.SPRINGER_OA_API_KEY ?? process.env.SPRINGER_API_KEY;
  if (!apiKey) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "SPRINGER_OA_API_KEY not configured" };
  }

  // Springer OpenAccess API — only for OA content
  // Try JSON endpoint first (wraps JATS in JSON), fallback to raw JATS
  const jsonUrl = `https://api.springernature.com/openaccess/json?q=doi:${encodeURIComponent(plan.doi)}&api_key=${encodeURIComponent(apiKey)}`;
  const jatsUrl = `https://api.springernature.com/openaccess/jats?q=doi:${encodeURIComponent(plan.doi)}&api_key=${encodeURIComponent(apiKey)}`;

  // Try JSON wrapper first
  let body: string | null = null;
  const jsonRes = await fetchWithRetry(jsonUrl, { headers: { Accept: "application/json" } });
  if (jsonRes.ok) {
    try {
      const data = (await jsonRes.json()) as { records?: { body?: string }[] };
      body = data.records?.[0]?.body ?? null;
    } catch {
      // JSON parse failed — try JATS endpoint
    }
  }

  // Fallback: raw JATS XML
  if (!body) {
    const jatsRes = await fetchWithRetry(jatsUrl);
    if (jatsRes.ok) {
      const xml = await jatsRes.text();
      if (xml.length > 200) {
        body = xml;
      }
    } else {
      return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: `Springer OA API failed: ${jatsRes.status}` };
    }
  }

  if (!body) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "Springer OA API returned no content for this DOI" };
  }

  const dir = artifactDir(plan.doi, cacheDir);
  const xmlPath = join(dir, "fulltext.xml");
  writeFileSync(xmlPath, body, "utf-8");

  return {
    success: true,
    artifact_path: xmlPath,
    artifact_type: "xml",
    source_url: jatsUrl.split("?")[0],
    error: null,
  };
}

// ── Wiley TDM route ───────────────────────────────────────────────

async function executeWileyTdm(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  if (!plan.doi) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI" };
  }

  const result = await fetchWileyTdm(plan.doi);
  if (!result.success || !result.content) {
    // Include TDM links in the error so the caller can try browser route
    const linksHint = result.tdm_links?.length
      ? ` TDM links for browser fallback: ${result.tdm_links.map((l) => l.url).join(", ")}`
      : "";
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      source_url: null,
      error: (result.error ?? "Wiley TDM retrieval failed") + linksHint,
    };
  }

  const dir = artifactDir(plan.doi, cacheDir);

  if (result.content_type === "pdf") {
    // Content is base64-encoded PDF
    const filePath = join(dir, "fulltext.pdf");
    writeFileSync(filePath, Buffer.from(result.content, "base64"));
    return {
      success: true,
      artifact_path: filePath,
      artifact_type: "pdf",
      source_url: result.source_url ?? null,
      error: null,
    };
  }

  // Default: XML or text
  const filePath = join(dir, "fulltext.xml");
  writeFileSync(filePath, result.content, "utf-8");
  return {
    success: true,
    artifact_path: filePath,
    artifact_type: result.content_type ?? "xml",
    source_url: result.source_url ?? null,
    error: null,
  };
}

// ── Browser route ─────────────────────────────────────────────────

async function executeBrowserRoute(
  plan: AccessPlan,
  cacheDir: string,
): Promise<RouteResult> {
  // Build URL from DOI landing page
  const url = plan.doi
    ? `https://doi.org/${plan.doi}`
    : null;

  if (!url) {
    return { success: false, artifact_path: null, artifact_type: null, source_url: null, error: "No DOI for browser route" };
  }

  const result = await browserRetrieve(url, "./browser-state", cacheDir, plan.doi ?? null, "navigate");

  if (result.needs_human_interaction) {
    // Return a special result — the caller (LLM) must relay this to the user
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      source_url: result.page_url,
      error: `NEEDS_HUMAN: ${result.human_message}`,
    };
  }

  if (result.success && result.artifact_path) {
    return {
      success: true,
      artifact_path: result.artifact_path,
      artifact_type: result.artifact_type,
      source_url: result.page_url,
      error: null,
    };
  }

  return {
    success: false,
    artifact_path: null,
    artifact_type: null,
    source_url: result.page_url,
    error: result.error ?? "Browser retrieval failed",
  };
}

// ── Shared helpers ────────────────────────────────────────────────

async function downloadPdf(
  pdfUrl: string,
  doi: string,
  cacheDir: string,
): Promise<RouteResult> {
  const res = await fetchWithRetry(pdfUrl, {
    redirect: "follow",
    headers: { Accept: "application/pdf, */*" },
  });

  if (!res.ok) {
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      source_url: pdfUrl,
      error: `Download failed: ${res.status} ${res.statusText}`,
    };
  }

  const contentType = res.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await res.arrayBuffer());

  // Determine if we got a PDF or HTML
  const isPdf = contentType.includes("pdf") || buffer.slice(0, 5).toString() === "%PDF-";
  const dir = artifactDir(doi, cacheDir);
  const filename = isPdf ? "fulltext.pdf" : "fulltext.html";
  const filePath = join(dir, filename);
  writeFileSync(filePath, buffer);

  return {
    success: true,
    artifact_path: filePath,
    artifact_type: isPdf ? "pdf" : "html",
    source_url: pdfUrl,
    error: null,
  };
}

/**
 * Import a local file into the cache.
 */
export function importLocalFile(
  filePath: string,
  doi: string | null,
  title: string | null,
  cacheDir: string = "./cache",
): { artifact_path: string; artifact_type: string; paper_id: string } {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase().replace(".", "");
  const artifactType = ext === "pdf" ? "pdf" : ext === "xml" ? "xml" : ext === "html" ? "html" : "text";
  const paperId = doi ?? `local:${title ?? filePath}`;

  const dir = artifactDir(doi, cacheDir);
  const destPath = join(dir, `fulltext.${ext || "txt"}`);
  copyFileSync(filePath, destPath);

  if (doi) {
    cacheArtifact(doi, destPath, artifactType, cacheDir);
  }

  return { artifact_path: destPath, artifact_type: artifactType, paper_id: paperId };
}
