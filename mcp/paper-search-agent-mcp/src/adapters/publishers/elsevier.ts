/**
 * Elsevier publisher adapter.
 * Implements the Article Retrieval API for entitled full-text access.
 * Docs: https://dev.elsevier.com/documentation/ArticleRetrievalAPI.wadl
 *
 * Entitlement path: personal API key + campus-network IP.
 * Without campus-network entitlement, only abstracts may be returned.
 */
import { fetchWithRetry } from "../../utils/http.js";

const BASE = "https://api.elsevier.com/content/article/doi";

export interface ElsevierRetrievalResult {
  success: boolean;
  content: string | null;
  content_type: "xml" | "text" | null;
  entitled: boolean;
  error: string | null;
}

/**
 * Preflight check: verify that entitlement exists for a given DOI.
 * Uses a HEAD request to avoid downloading the full content.
 */
export async function preflightElsevier(
  doi: string,
  apiKey: string,
): Promise<{ entitled: boolean; reason: string }> {
  const url = `${BASE}/${encodeURIComponent(doi)}`;

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "X-ELS-APIKey": apiKey,
      Accept: "application/json",
    },
  });

  if (res.ok) {
    // Check if the response contains full text or just abstract
    const data = (await res.json()) as ElsevierArticleResponse;
    const coredata = data["full-text-retrieval-response"]?.coredata;
    if (coredata) {
      return { entitled: true, reason: "Full text accessible" };
    }
    // Might have gotten just metadata/abstract
    return { entitled: false, reason: "Response lacks full text — likely abstract only" };
  }

  if (res.status === 401) {
    return { entitled: false, reason: "Invalid API key (401)" };
  }
  if (res.status === 403) {
    return { entitled: false, reason: "Not entitled — campus-network access may be required (403)" };
  }
  if (res.status === 404) {
    return { entitled: false, reason: "DOI not found in Elsevier (404)" };
  }
  if (res.status === 429) {
    return { entitled: false, reason: "Rate limited by Elsevier API (429)" };
  }

  return { entitled: false, reason: `Unexpected status: ${res.status}` };
}

/**
 * Fetch full-text content from Elsevier Article Retrieval API.
 * Tries XML first, falls back to plain text.
 */
export async function fetchElsevierFulltext(
  doi: string,
  apiKey: string,
): Promise<ElsevierRetrievalResult> {
  // Try XML first (richest format)
  const xmlResult = await fetchElsevierFormat(doi, apiKey, "text/xml");
  if (xmlResult.success) return xmlResult;

  // Fall back to plain text
  const textResult = await fetchElsevierFormat(doi, apiKey, "text/plain");
  if (textResult.success) return textResult;

  // Both failed
  return {
    success: false,
    content: null,
    content_type: null,
    entitled: false,
    error: xmlResult.error ?? textResult.error ?? "Retrieval failed",
  };
}

async function fetchElsevierFormat(
  doi: string,
  apiKey: string,
  accept: "text/xml" | "text/plain",
): Promise<ElsevierRetrievalResult> {
  const url = `${BASE}/${encodeURIComponent(doi)}`;

  const res = await fetchWithRetry(url, {
    headers: {
      "X-ELS-APIKey": apiKey,
      Accept: accept,
    },
  });

  if (!res.ok) {
    const entitled = res.status !== 403 && res.status !== 401;
    return {
      success: false,
      content: null,
      content_type: null,
      entitled,
      error: `Elsevier API returned ${res.status}: ${res.statusText}`,
    };
  }

  const content = await res.text();
  if (!content || content.length < 200) {
    return {
      success: false,
      content: null,
      content_type: null,
      entitled: true,
      error: "Response too short — may be abstract only",
    };
  }

  const contentType: "xml" | "text" = accept === "text/xml" ? "xml" : "text";
  return {
    success: true,
    content,
    content_type: contentType,
    entitled: true,
    error: null,
  };
}

// ── Internal types ────────────────────────────────────────────────

interface ElsevierArticleResponse {
  "full-text-retrieval-response"?: {
    coredata?: Record<string, unknown>;
  };
}
