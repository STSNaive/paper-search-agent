/**
 * Wiley TDM (Text and Data Mining) retrieval adapter.
 *
 * The legacy api.wiley.com TDM v1 endpoint required a CrossRef Click-Through
 * token, but that service has been discontinued. Wiley now registers TDM-intended
 * links directly in Crossref metadata (intended-application: "text-mining"):
 *   - https://onlinelibrary.wiley.com/doi/full-xml/{doi}  (XML)
 *   - https://onlinelibrary.wiley.com/doi/pdf/{doi}       (PDF)
 *
 * Access to these URLs requires either:
 *   - Institutional IP range (campus network)
 *   - An authenticated Wiley session (via browser)
 *   - The article being OA (CC BY, etc.)
 *
 * This adapter resolves TDM links from Crossref, then attempts a direct
 * HTTP download. When blocked by Cloudflare / entitlement, it returns the
 * URLs so the caller can fall back to the browser HITL route.
 *
 * Docs: https://onlinelibrary.wiley.com/library-info/resources/text-and-datamining
 */

export interface WileyTdmLink {
  url: string;
  content_type: "xml" | "pdf" | "unknown";
  intended_application: string;
}

export interface WileyTdmResult {
  success: boolean;
  content?: string;
  content_type?: "xml" | "pdf";
  source_url?: string;
  /** When direct download fails, these URLs can be used with the browser route */
  tdm_links?: WileyTdmLink[];
  error?: string;
}

/**
 * Resolve TDM links for a Wiley DOI from Crossref metadata.
 */
export async function getWileyTdmLinks(doi: string): Promise<WileyTdmLink[]> {
  try {
    const email = process.env.UNPAYWALL_EMAIL ?? "paper-search-agent";
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": `paper-search-agent/1.0 (mailto:${email})`,
      },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      message?: {
        link?: Array<{
          URL: string;
          "content-type"?: string;
          "intended-application"?: string;
        }>;
      };
    };

    const links = data.message?.link ?? [];
    return links
      .filter((l) => l["intended-application"] === "text-mining")
      .map((l) => ({
        url: l.URL,
        content_type: l["content-type"]?.includes("xml")
        ? "xml" as const
        : l["content-type"]?.includes("pdf")
          ? "pdf" as const
          : "unknown" as const,
      intended_application: l["intended-application"] ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Attempt to download full text of a Wiley article using TDM links.
 * Prefers XML over PDF. Falls back gracefully when direct access is blocked.
 */
export async function fetchWileyTdm(doi: string): Promise<WileyTdmResult> {
  let tdmLinks = await getWileyTdmLinks(doi);

  // If Crossref has no TDM links, construct standard Wiley URLs from the DOI
  if (tdmLinks.length === 0) {
    tdmLinks = [
      { url: `https://onlinelibrary.wiley.com/doi/full-xml/${doi}`, content_type: "xml", intended_application: "text-mining" },
      { url: `https://onlinelibrary.wiley.com/doi/pdf/${doi}`, content_type: "pdf", intended_application: "text-mining" },
    ];
  }

  if (tdmLinks.length === 0) {
    return { success: false, error: "No TDM links found in Crossref metadata for this DOI" };
  }

  // Sort: prefer XML links first (more LLM-friendly)
  const sorted = [...tdmLinks].sort((a, b) => {
    if (a.content_type === "xml" && b.content_type !== "xml") return -1;
    if (a.content_type !== "xml" && b.content_type === "xml") return 1;
    return 0;
  });

  // Try each link in order
  for (const link of sorted) {
    try {
      const accept =
        link.content_type === "xml"
          ? "application/xml"
          : link.content_type === "pdf"
            ? "application/pdf"
            : "*/*";

      const res = await fetch(link.url, {
        headers: { Accept: accept },
        redirect: "follow",
      });

      if (!res.ok) continue;

      const ct = res.headers.get("content-type") ?? "";

      // Cloudflare challenge pages return text/html even on 200
      if (ct.includes("text/html")) {
        const peek = await res.text();
        if (peek.includes("Just a moment") || peek.includes("cf-browser-verification")) {
          continue; // Cloudflare block — skip to next link
        }
      }

      if (ct.includes("xml") || link.content_type === "xml") {
        const content = await res.text();
        if (content.length > 200 && content.includes("<")) {
          return { success: true, content, content_type: "xml", source_url: link.url, tdm_links: tdmLinks };
        }
      }

      if (ct.includes("pdf") || link.content_type === "pdf") {
        // Read PDF as binary text — the caller will write raw bytes
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 1000) {
          return { success: true, content: buf.toString("base64"), content_type: "pdf", source_url: link.url, tdm_links: tdmLinks };
        }
      }
    } catch {
      continue; // Network error — try next link
    }
  }

  // All direct attempts failed — return links for browser fallback
  return {
    success: false,
    tdm_links: tdmLinks,
    error: "Direct download blocked (Cloudflare / entitlement). Use browser route with the provided TDM links.",
  };
}
