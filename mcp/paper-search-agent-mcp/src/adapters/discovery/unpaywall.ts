/**
 * Unpaywall OA location adapter.
 * Per-DOI lookup via the Unpaywall API.
 * Docs: https://unpaywall.org/products/api
 */

export interface UnpaywallResult {
  doi: string;
  is_oa: boolean;
  best_oa_url: string | null;
  oa_status: string | null;
}

const BASE = "https://api.unpaywall.org/v2";

/**
 * Look up a DOI in Unpaywall to find the best OA copy.
 * Requires an email address (set via UNPAYWALL_EMAIL env var).
 */
export async function lookupUnpaywall(
  doi: string,
  email?: string,
): Promise<UnpaywallResult> {
  const mailto = email ?? process.env.UNPAYWALL_EMAIL;
  if (!mailto) {
    throw new Error("UNPAYWALL_EMAIL is required for Unpaywall lookups");
  }

  const url = `${BASE}/${encodeURIComponent(doi)}?email=${encodeURIComponent(mailto)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (res.status === 404) {
    return { doi, is_oa: false, best_oa_url: null, oa_status: null };
  }
  if (!res.ok) {
    throw new Error(`Unpaywall lookup failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as UnpaywallApiResponse;
  const bestUrl =
    data.best_oa_location?.url_for_pdf ??
    data.best_oa_location?.url ??
    null;

  return {
    doi: data.doi ?? doi,
    is_oa: data.is_oa ?? false,
    best_oa_url: bestUrl,
    oa_status: data.oa_status ?? null,
  };
}

// ── Internal types ────────────────────────────────────────────────

interface UnpaywallApiResponse {
  doi?: string;
  is_oa?: boolean;
  oa_status?: string;
  best_oa_location?: {
    url?: string;
    url_for_pdf?: string;
    url_for_landing_page?: string;
  };
}
