/**
 * Elsevier publisher adapter.
 * Implements the Article Retrieval API for entitled full-text access.
 * Docs: https://dev.elsevier.com/documentation/ArticleRetrievalAPI.wadl
 *
 * Entitlement path: personal API key + campus-network IP.
 * Without campus-network entitlement, abstract-level XML may be returned.
 */
import { fetchWithRetry } from "../../utils/http.js";

const BASE = "https://api.elsevier.com/content/article/doi";

export interface ElsevierRetrievalResult {
  success: boolean;
  content: string | null;
  content_type: "xml" | "text" | null;
  entitled: boolean;
  error: string | null;
  retry_with_plaintext?: boolean;
}

/**
 * Preflight check: verify that entitlement exists for a given DOI.
 * Uses a GET request because Elsevier's response shape tells us whether
 * the FULL view actually contains article-body data.
 */
export async function preflightElsevier(
  doi: string,
  apiKey: string,
): Promise<{ entitled: boolean; reason: string }> {
  const url = buildElsevierArticleUrl(doi);

  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "X-ELS-APIKey": apiKey,
      Accept: "application/json",
    },
  });

  if (res.ok) {
    const payload = JSON.stringify(await res.json());
    if (hasElsevierFullText(payload)) {
      return { entitled: true, reason: "FULL view contains article-body data" };
    }
    if (hasElsevierAbstract(payload)) {
      return { entitled: false, reason: "Elsevier returned abstract-level metadata only" };
    }
    return { entitled: false, reason: "Elsevier response lacks recognizable full-text markers" };
  }

  if (res.status === 401) {
    return { entitled: false, reason: "Invalid API key (401)" };
  }
  if (res.status === 403) {
    return { entitled: false, reason: "Not entitled; campus-network access may be required (403)" };
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
 * Prefer XML; only fall back to plain text when the XML request failed in a
 * way that could plausibly be format-specific.
 */
export async function fetchElsevierFulltext(
  doi: string,
  apiKey: string,
): Promise<ElsevierRetrievalResult> {
  const xmlResult = await fetchElsevierFormat(doi, apiKey, "text/xml");
  if (xmlResult.success || !xmlResult.retry_with_plaintext) {
    return finalizeResult(xmlResult);
  }

  const textResult = await fetchElsevierFormat(doi, apiKey, "text/plain");
  if (textResult.success) {
    return finalizeResult(textResult);
  }

  return finalizeResult({
    success: false,
    content: null,
    content_type: null,
    entitled: xmlResult.entitled || textResult.entitled,
    error: xmlResult.error ?? textResult.error ?? "Retrieval failed",
    retry_with_plaintext: false,
  });
}

async function fetchElsevierFormat(
  doi: string,
  apiKey: string,
  accept: "text/xml" | "text/plain",
): Promise<ElsevierRetrievalResult> {
  const url = buildElsevierArticleUrl(doi);

  const res = await fetchWithRetry(url, {
    headers: {
      "X-ELS-APIKey": apiKey,
      Accept: accept,
    },
  });

  if (!res.ok) {
    const retryWithPlainText = accept === "text/xml" && ![401, 403, 404].includes(res.status);
    return {
      success: false,
      content: null,
      content_type: null,
      entitled: res.status !== 403 && res.status !== 401,
      error: `Elsevier API returned ${res.status}: ${res.statusText}`,
      retry_with_plaintext: retryWithPlainText,
    };
  }

  const content = await res.text();
  if (!content || content.length < 200) {
    return {
      success: false,
      content: null,
      content_type: null,
      entitled: true,
      error: "Response too short; may be abstract only",
      retry_with_plaintext: false,
    };
  }

  if (accept === "text/xml" && !hasElsevierFullText(content)) {
    return {
      success: false,
      content: null,
      content_type: null,
      entitled: true,
      error: hasElsevierAbstract(content)
        ? "Elsevier API returned abstract-level XML only; FULL view did not include article body."
        : "Elsevier API XML lacks article-body markers.",
      retry_with_plaintext: false,
    };
  }

  return {
    success: true,
    content,
    content_type: accept === "text/xml" ? "xml" : "text",
    entitled: true,
    error: null,
    retry_with_plaintext: false,
  };
}

function finalizeResult(result: ElsevierRetrievalResult): ElsevierRetrievalResult {
  const { retry_with_plaintext: _retryWithPlainText, ...rest } = result;
  return rest;
}

function buildElsevierArticleUrl(doi: string): string {
  const url = new URL(`${BASE}/${encodeURIComponent(doi)}`);
  url.searchParams.set("view", "FULL");
  return url.toString();
}

function hasElsevierFullText(xml: string): boolean {
  return [
    /<body\b/i,
    /<ce:sections?\b/i,
    /<ce:section\b/i,
    /<ce:para\b/i,
    /<xocs:item-weight>\s*FULL-TEXT\s*<\/xocs:item-weight>/i,
    /<xocs:rawtext\b/i,
  ].some((pattern) => pattern.test(xml));
}

function hasElsevierAbstract(xml: string): boolean {
  return /<dc:description\b/i.test(xml) || /<abstract\b/i.test(xml);
}
