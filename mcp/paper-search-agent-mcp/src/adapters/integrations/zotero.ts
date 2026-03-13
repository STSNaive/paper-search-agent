/**
 * Zotero Web API adapter.
 * Uses Zotero Web API v3 directly (no Zotero desktop client required).
 * Supports lookup by DOI/title/query and saving items with metadata.
 *
 * API docs: https://www.zotero.org/support/dev/web_api/v3/basics
 */
import { fetchWithRetry } from "../../utils/http.js";

const ZOTERO_API_BASE = "https://api.zotero.org";

export interface ZoteroConfig {
  apiKey: string;
  libraryId: string;
  libraryType: "user" | "group";
}

export interface ZoteroItem {
  key: string;
  version: number;
  itemType: string;
  title: string;
  doi?: string;
  url?: string;
  date?: string;
  creators?: Array<{ firstName?: string; lastName?: string; name?: string; creatorType: string }>;
  tags?: Array<{ tag: string }>;
  attachments?: Array<{
    key: string;
    title: string;
    contentType: string;
    url?: string;
  }>;
}

export interface ZoteroLookupResult {
  found: boolean;
  items: ZoteroItem[];
  total_results: number;
  has_pdf: boolean;
  pdf_attachment_key?: string;
}

export interface ZoteroSaveResult {
  success: boolean;
  item_key?: string;
  error?: string;
}

export interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
  numItems: number;
}

function libraryPrefix(cfg: ZoteroConfig): string {
  return cfg.libraryType === "group"
    ? `groups/${cfg.libraryId}`
    : `users/${cfg.libraryId}`;
}

function headers(cfg: ZoteroConfig): Record<string, string> {
  return {
    "Zotero-API-Key": cfg.apiKey,
    "Zotero-API-Version": "3",
    "Content-Type": "application/json",
  };
}

/**
 * Load Zotero config from environment variables.
 * Returns null if required variables are missing.
 */
export function loadZoteroConfig(): ZoteroConfig | null {
  const apiKey = process.env.ZOTERO_API_KEY;
  const libraryId = process.env.ZOTERO_LIBRARY_ID;
  const libraryType = (process.env.ZOTERO_LIBRARY_TYPE ?? "user") as "user" | "group";

  if (!apiKey || !libraryId) return null;

  return { apiKey, libraryId, libraryType };
}

function parseItems(rawItems: Array<Record<string, unknown>>): ZoteroItem[] {
  return rawItems.map((raw) => {
    const data = raw.data as Record<string, unknown>;
    return {
      key: raw.key as string,
      version: raw.version as number,
      itemType: data.itemType as string,
      title: (data.title as string) ?? "",
      doi: (data.DOI as string) ?? undefined,
      url: (data.url as string) ?? undefined,
      date: (data.date as string) ?? undefined,
      creators: (data.creators as ZoteroItem["creators"]) ?? [],
      tags: (data.tags as ZoteroItem["tags"]) ?? [],
    };
  });
}

/**
 * Search the user's Zotero library. Supports:
 *   - DOI lookup (exact match via `doi:` search term)
 *   - Title search
 *   - Free-text query
 *
 * Returns matching items with attachment metadata.
 */
export async function zoteroLookup(
  cfg: ZoteroConfig,
  opts: { doi?: string; title?: string; query?: string },
): Promise<ZoteroLookupResult> {
  const prefix = libraryPrefix(cfg);

  let items: ZoteroItem[] = [];
  let totalResults = 0;

  // Strategy 1: If DOI given, try a targeted search first, then fall back
  // to fetching recent items and filtering by DOI client-side
  // (Zotero's search API doesn't reliably index the DOI field)
  if (opts.doi) {
    // Try search with DOI string
    const searchUrl = `${ZOTERO_API_BASE}/${prefix}/items?q=${encodeURIComponent(opts.doi)}&qmode=everything&limit=50&format=json`;
    const resp = await fetchWithRetry(searchUrl, { headers: headers(cfg) });
    if (resp.ok) {
      const raw = (await resp.json()) as Array<Record<string, unknown>>;
      items = parseItems(raw);
      totalResults = parseInt(resp.headers.get("Total-Results") ?? "0", 10);
    }

    // Filter by exact DOI match
    const doiLower = opts.doi.toLowerCase();
    let matched = items.filter((it) => it.doi && it.doi.toLowerCase() === doiLower);

    // If not found, try fetching recent items (sorted by dateModified) and filter
    if (matched.length === 0) {
      const recentUrl = `${ZOTERO_API_BASE}/${prefix}/items?sort=dateModified&direction=desc&limit=100&format=json`;
      const resp2 = await fetchWithRetry(recentUrl, { headers: headers(cfg) });
      if (resp2.ok) {
        const raw2 = (await resp2.json()) as Array<Record<string, unknown>>;
        const recentItems = parseItems(raw2);
        matched = recentItems.filter((it) => it.doi && it.doi.toLowerCase() === doiLower);
        if (matched.length > 0) {
          items = matched;
          totalResults = matched.length;
        }
      }
    } else {
      items = matched;
    }
  } else {
    // Title or free-text query
    const qParam = opts.title ?? opts.query;
    if (!qParam) {
      return { found: false, items: [], total_results: 0, has_pdf: false };
    }

    const url = `${ZOTERO_API_BASE}/${prefix}/items?q=${encodeURIComponent(qParam)}&qmode=titleCreatorYear&limit=25&format=json`;
    const resp = await fetchWithRetry(url, { headers: headers(cfg) });
    if (!resp.ok) {
      throw new Error(`Zotero API error: ${resp.status} ${resp.statusText}`);
    }
    const raw = (await resp.json()) as Array<Record<string, unknown>>;
    items = parseItems(raw);
    totalResults = parseInt(resp.headers.get("Total-Results") ?? "0", 10);
  }

  // Filter out attachments and notes
  const filtered = items.filter((it) => it.itemType !== "attachment" && it.itemType !== "note");

  // Check for PDF attachments on first matched item
  let hasPdf = false;
  let pdfKey: string | undefined;

  if (filtered.length > 0) {
    const childrenUrl = `${ZOTERO_API_BASE}/${prefix}/items/${filtered[0].key}/children?format=json`;
    try {
      const childResp = await fetchWithRetry(childrenUrl, { headers: headers(cfg) });
      if (childResp.ok) {
        const children = (await childResp.json()) as Array<Record<string, unknown>>;
        for (const child of children) {
          const cData = child.data as Record<string, unknown>;
          if (cData.contentType === "application/pdf") {
            hasPdf = true;
            pdfKey = child.key as string;
            break;
          }
        }
      }
    } catch {
      // Non-critical: attachment lookup failed
    }
  }

  return {
    found: filtered.length > 0,
    items: filtered,
    total_results: totalResults,
    has_pdf: hasPdf,
    pdf_attachment_key: pdfKey,
  };
}

/**
 * List all collections in the user's Zotero library.
 * Useful for letting the user choose which collection to save papers into.
 */
export async function zoteroListCollections(
  cfg: ZoteroConfig,
): Promise<ZoteroCollection[]> {
  const prefix = libraryPrefix(cfg);
  const url = `${ZOTERO_API_BASE}/${prefix}/collections?format=json&limit=100`;

  const resp = await fetchWithRetry(url, { headers: headers(cfg) });
  if (!resp.ok) {
    throw new Error(`Zotero API error: ${resp.status} ${resp.statusText}`);
  }

  const raw = (await resp.json()) as Array<Record<string, unknown>>;
  return raw.map((c) => {
    const data = c.data as Record<string, unknown>;
    return {
      key: c.key as string,
      name: data.name as string,
      parentCollection: (data.parentCollection as string | false) ?? false,
      numItems: (c.meta as Record<string, unknown>)?.numItems as number ?? 0,
    };
  });
}

/**
 * Save a paper to the user's Zotero library.
 * Creates a journal article item with the provided metadata.
 * Optionally places it in one or more collections.
 */
export async function zoteroSave(
  cfg: ZoteroConfig,
  metadata: {
    doi?: string;
    title: string;
    authors?: string[];
    year?: string;
    venue?: string;
    abstract?: string;
    url?: string;
    tags?: string[];
    collections?: string[];
  },
): Promise<ZoteroSaveResult> {
  const prefix = libraryPrefix(cfg);

  // Build Zotero item data
  const creators = (metadata.authors ?? []).map((name) => {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      return {
        creatorType: "author",
        firstName: parts.slice(0, -1).join(" "),
        lastName: parts[parts.length - 1],
      };
    }
    return { creatorType: "author", name };
  });

  const itemData: Record<string, unknown> = {
    itemType: "journalArticle",
    title: metadata.title,
    DOI: metadata.doi ?? "",
    url: metadata.url ?? (metadata.doi ? `https://doi.org/${metadata.doi}` : ""),
    date: metadata.year ?? "",
    publicationTitle: metadata.venue ?? "",
    abstractNote: metadata.abstract ?? "",
    creators,
    tags: (metadata.tags ?? []).map((t) => ({ tag: t })),
    collections: metadata.collections ?? [],
  };

  const url = `${ZOTERO_API_BASE}/${prefix}/items`;
  const resp = await fetchWithRetry(url, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify([itemData]),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { success: false, error: `Zotero save failed: ${resp.status} — ${body}` };
  }

  const result = (await resp.json()) as Record<string, unknown>;
  const successful = result.successful as Record<string, Record<string, unknown>> | undefined;
  if (successful && successful["0"]) {
    return { success: true, item_key: successful["0"].key as string };
  }

  const failed = result.failed as Record<string, Record<string, unknown>> | undefined;
  if (failed && failed["0"]) {
    return { success: false, error: JSON.stringify(failed["0"]) };
  }

  return { success: true };
}
