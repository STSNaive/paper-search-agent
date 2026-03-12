/**
 * Access planner — decides the best retrieval route for a candidate paper.
 *
 * Implements the routing logic from design-plan.md §5.2:
 * 1. Canonicalize identifier (prefer DOI)
 * 2. Infer publisher from DOI prefix / Crossref metadata
 * 3. Check local cache
 * 4. Check Zotero (if enabled)
 * 5. Check OA routes (OpenAlex, Unpaywall, Europe PMC)
 * 6. Evaluate publisher API routes (Elsevier, Springer OA, Wiley TDM)
 * 7. Evaluate browser routes
 * 8. Fall back to manual import
 */

import type { AppConfig } from "../config.js";
import type {
  CandidatePaper,
  AccessPlan,
  RetrievalRoute,
  EntitlementConfidence,
} from "../schemas/index.js";
import { normalizeDoi, publisherFromDoiPrefix, doiToSafePath } from "../utils/doi.js";
import { checkCache } from "../adapters/storage/local-store.js";
import { lookupOpenAlexByDoi } from "../adapters/discovery/openalex.js";
import { lookupUnpaywall } from "../adapters/discovery/unpaywall.js";
import { resolveDoiViaCrossref } from "../adapters/discovery/crossref.js";

export interface PlanContext {
  /** Resolved OA status from OpenAlex */
  oaOpenAlex: { is_oa: boolean; best_oa_url: string | null } | null;
  /** Resolved OA status from Unpaywall */
  oaUnpaywall: { is_oa: boolean; best_oa_url: string | null } | null;
  /** Publisher inferred from DOI prefix or Crossref */
  publisher: string | null;
  /** Whether a local cache hit was found */
  cacheHit: boolean;
  /** Notes accumulated during planning */
  notes: string[];
}

/**
 * Create an access plan for a single candidate paper.
 */
export async function createAccessPlan(
  candidate: CandidatePaper,
  config: AppConfig,
): Promise<AccessPlan> {
  const ctx: PlanContext = {
    oaOpenAlex: null,
    oaUnpaywall: null,
    publisher: candidate.publisher_hint ?? null,
    cacheHit: false,
    notes: [],
  };

  // 1. Canonicalize DOI
  const doi = candidate.doi ? normalizeDoi(candidate.doi) : null;
  const paperId = doi ?? `title:${candidate.title.slice(0, 80)}`;

  // 2. Infer publisher from DOI prefix (if not already set)
  if (doi && !ctx.publisher) {
    ctx.publisher = publisherFromDoiPrefix(doi);
  }

  // If still unknown, try Crossref resolution
  if (doi && !ctx.publisher) {
    try {
      const crResult = await resolveDoiViaCrossref(doi);
      if (crResult?.publisher_hint) {
        ctx.publisher = crResult.publisher_hint;
        ctx.notes.push(`Publisher inferred from Crossref: ${crResult.publisher ?? "unknown"}`);
      }
    } catch {
      ctx.notes.push("Crossref DOI resolution failed — publisher inference skipped");
    }
  }

  // 3. Check local cache
  if (doi) {
    const cache = checkCache(doi, "./cache");
    if (cache.found) {
      ctx.cacheHit = true;
      ctx.notes.push(`Local cache hit: ${cache.path}`);
    }
  }

  // 4. Check OA routes (OpenAlex + Unpaywall) — in parallel
  if (doi) {
    const [oaResult, upResult] = await Promise.allSettled([
      config.discovery.openalex
        ? lookupOpenAlexByDoi(doi)
        : Promise.resolve(null),
      config.discovery.unpaywall
        ? lookupUnpaywall(doi).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (oaResult.status === "fulfilled" && oaResult.value) {
      ctx.oaOpenAlex = {
        is_oa: oaResult.value.is_oa,
        best_oa_url: oaResult.value.best_oa_url,
      };
    }
    if (upResult.status === "fulfilled" && upResult.value) {
      ctx.oaUnpaywall = {
        is_oa: upResult.value.is_oa,
        best_oa_url: upResult.value.best_oa_url,
      };
    }
  }

  // 5–8. Build routes in priority order
  const routes = buildRoutes(doi, ctx, config);
  const entitlementState = buildEntitlementState(doi, ctx, config);

  const preferred = routes[0] ?? "manual_import_pdf";
  const alternatives = routes.slice(1);

  return {
    paper_id: paperId,
    doi,
    publisher: ctx.publisher,
    preferred_route: preferred,
    alternative_routes: alternatives,
    entitlement_state: entitlementState,
    required_env: buildRequiredEnv(ctx, config),
    expected_output: guessOutputType(preferred, ctx.publisher),
    compliance_constraints: buildComplianceNotes(preferred, ctx.publisher),
    notes: ctx.notes.join("; "),
  };
}

/**
 * Build an ordered list of viable routes based on context and config.
 */
function buildRoutes(
  doi: string | null,
  ctx: PlanContext,
  config: AppConfig,
): RetrievalRoute[] {
  const routes: RetrievalRoute[] = [];

  // ── Priority 1: local cache ─────────────────────────────────────
  if (ctx.cacheHit) {
    routes.push("local_cache");
  }

  // ── Priority 2: Zotero existing ──────────────────────────────────
  if (config.integrations.zotero) {
    routes.push("zotero_existing");
    ctx.notes.push("Zotero library check available as early retrieval shortcut");
  }

  // ── Priority 3: Structured-text routes (XML > text) ─────────────
  // These return LLM-friendly structured text and should be
  // preferred over PDF routes to save tokens and parsing cost.

  // Europe PMC free JATS XML — no API key needed, covers biomedical
  if (config.retrieval.europe_pmc_fulltext) {
    routes.push("europe_pmc_fulltext");
    ctx.notes.push("Europe PMC XML preferred for LLM-friendly structured text");
  }

  // Elsevier API → XML (campus-entitled)
  if (doi && ctx.publisher === "elsevier" && config.retrieval.elsevier_api) {
    if (process.env.ELSEVIER_API_KEY) {
      routes.push("elsevier_api_fulltext");
      ctx.notes.push("Elsevier API route available (returns XML; entitlement depends on campus network)");
    } else {
      ctx.notes.push("Elsevier API route skipped — no ELSEVIER_API_KEY");
    }
  }

  // Springer OA API → JATS XML (OA content only)
  if (doi && ctx.publisher === "springer" && config.retrieval.springer_oa_api) {
    if (ctx.oaOpenAlex?.is_oa || ctx.oaUnpaywall?.is_oa) {
      routes.push("springer_oa_api");
      ctx.notes.push("Springer OA API route available (returns JATS XML)");
    } else {
      ctx.notes.push("Springer OA API route skipped — paper is not OA; subscription Springer requires browser route");
    }
  }

  // ── Priority 4: OA PDF routes (fallback after structured text) ──
  if (ctx.oaOpenAlex?.is_oa && ctx.oaOpenAlex.best_oa_url) {
    routes.push("oa_openalex");
    ctx.notes.push(`OpenAlex OA PDF: ${ctx.oaOpenAlex.best_oa_url}`);
  }
  if (ctx.oaUnpaywall?.is_oa && ctx.oaUnpaywall.best_oa_url) {
    if (!routes.includes("oa_openalex") || ctx.oaUnpaywall.best_oa_url !== ctx.oaOpenAlex?.best_oa_url) {
      routes.push("oa_unpaywall");
      ctx.notes.push(`Unpaywall OA PDF: ${ctx.oaUnpaywall.best_oa_url}`);
    }
  }

  // ── Priority 5: Wiley TDM (Crossref TDM links → direct or browser) ──
  if (doi && ctx.publisher === "wiley" && config.retrieval.wiley_tdm) {
    routes.push("wiley_tdm_download");
    ctx.notes.push("Wiley TDM route via Crossref TDM links (institutional IP or OA)");
  }

  // ── Priority 6: Browser route (subscription content, yields PDF) ─
  if (config.retrieval.browser_assisted) {
    routes.push("browser_download_pdf");
  }

  // ── Priority 7: Manual import (always available) ────────────────
  if (config.retrieval.manual_import) {
    routes.push("manual_import_pdf");
  }

  return routes;
}

/**
 * Build entitlement confidence assessments for each relevant route.
 */
function buildEntitlementState(
  doi: string | null,
  ctx: PlanContext,
  config: AppConfig,
): Partial<Record<RetrievalRoute, EntitlementConfidence>> {
  const state: Partial<Record<RetrievalRoute, EntitlementConfidence>> = {};

  if (ctx.cacheHit) {
    state.local_cache = "confirmed";
  }

  if (ctx.oaOpenAlex?.is_oa) {
    state.oa_openalex = "confirmed";
  }
  if (ctx.oaUnpaywall?.is_oa) {
    state.oa_unpaywall = "confirmed";
  }

  if (ctx.publisher === "elsevier" && config.retrieval.elsevier_api) {
    // Entitlement depends on campus network — can't confirm without preflight
    state.elsevier_api_fulltext = process.env.ELSEVIER_API_KEY ? "unknown" : "unlikely";
  }

  if (ctx.publisher === "springer") {
    state.springer_oa_api =
      ctx.oaOpenAlex?.is_oa || ctx.oaUnpaywall?.is_oa ? "likely" : "unlikely";
  }

  if (ctx.publisher === "wiley" && config.retrieval.wiley_tdm) {
    // Direct download depends on OA status or institutional IP; always worth trying
    state.wiley_tdm_download = ctx.oaOpenAlex?.is_oa || ctx.oaUnpaywall?.is_oa ? "likely" : "unknown";
  }

  state.browser_download_pdf = config.retrieval.browser_assisted ? "unknown" : "unlikely";
  state.manual_import_pdf = "not_applicable";

  return state;
}

/**
 * Build required environment variables per route.
 */
function buildRequiredEnv(
  ctx: PlanContext,
  config: AppConfig,
): Partial<Record<RetrievalRoute, string[]>> {
  const env: Partial<Record<RetrievalRoute, string[]>> = {};

  if (ctx.publisher === "elsevier" && config.retrieval.elsevier_api) {
    env.elsevier_api_fulltext = ["ELSEVIER_API_KEY", "campus_network"];
  }
  if (config.retrieval.wiley_tdm) {
    env.wiley_tdm_download = ["institutional_ip_or_oa"];
  }

  return env;
}

/**
 * Guess expected output type based on route and publisher.
 */
function guessOutputType(
  route: RetrievalRoute,
  publisher: string | null,
): "pdf" | "xml" | "html" | "text" {
  if (route === "elsevier_api_fulltext") return "xml";
  if (route === "springer_oa_api") return "xml";
  if (route === "europe_pmc_fulltext") return "xml";
  if (route === "wiley_tdm_download") return "xml"; // prefers XML, may fall back to PDF
  if (route === "browser_download_pdf") return "pdf";
  if (route === "manual_import_pdf") return "pdf";
  // OA routes typically point to PDFs
  return "pdf";
}

/**
 * Build compliance notes based on route.
 */
function buildComplianceNotes(
  route: RetrievalRoute,
  publisher: string | null,
): string[] {
  const notes: string[] = [];

  if (route === "elsevier_api_fulltext") {
    notes.push("Subscription content: keep in private local storage only");
    notes.push("Do not redistribute full text");
  }
  if (route === "wiley_tdm_download") {
    notes.push("TDM access via Crossref-registered links");
    notes.push("Subscription content requires institutional IP; OA content may be directly accessible");
  }
  if (route === "browser_download_pdf") {
    notes.push("Downloaded via institutional access: keep locally");
  }

  return notes;
}
