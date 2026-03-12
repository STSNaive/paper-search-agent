/**
 * AccessPlan — a retrieval strategy for a single paper.
 * Produced by the access planner, consumed by retrieval tools.
 */

/** Recognized retrieval route identifiers */
export type RetrievalRoute =
  | "local_cache"
  | "zotero_existing"
  | "oa_openalex"
  | "oa_unpaywall"
  | "oa_publisher"
  | "europe_pmc_fulltext"
  | "elsevier_api_fulltext"
  | "springer_oa_api"
  | "wiley_tdm_download"
  | "browser_download_pdf"
  | "browser_capture_html"
  | "manual_import_pdf";

/** Confidence in entitlement for a given route */
export type EntitlementConfidence = "confirmed" | "likely" | "unlikely" | "unknown" | "not_applicable";

export interface AccessPlan {
  /** Canonical paper identifier */
  paper_id: string;
  doi: string | null;
  /** Inferred publisher */
  publisher: string | null;
  /** The best available route */
  preferred_route: RetrievalRoute;
  /** Ordered fallback routes */
  alternative_routes: RetrievalRoute[];
  /** Entitlement assessment per route */
  entitlement_state: Partial<Record<RetrievalRoute, EntitlementConfidence>>;
  /** What credentials / conditions each route needs */
  required_env: Partial<Record<RetrievalRoute, string[]>>;
  /** Expected output artifact type */
  expected_output: "pdf" | "xml" | "html" | "text";
  /** Compliance constraints */
  compliance_constraints: string[];
  /** Human-readable explanation of decisions */
  notes: string;
}

/**
 * AccessAttempt — a record of a single retrieval attempt.
 */
export interface AccessAttempt {
  paper_id: string;
  doi: string | null;
  route: RetrievalRoute;
  timestamp: string;
  success: boolean;
  /** HTTP status or error code */
  status_code: number | null;
  /** Error message if failed */
  error: string | null;
  /** Artifact path if successful */
  artifact_path: string | null;
  /** Artifact type if successful */
  artifact_type: string | null;
  /** Time taken in milliseconds */
  duration_ms: number;
  /** Whether this was a retry or a first attempt */
  is_retry: boolean;
  /** What route to try next if this failed */
  next_fallback: RetrievalRoute | null;
}
