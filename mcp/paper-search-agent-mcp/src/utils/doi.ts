/**
 * Shared utility functions for paper-search-agent MCP server.
 */

/**
 * Normalize a DOI string: lowercase, trim whitespace, remove URL prefix.
 */
export function normalizeDoi(raw: string): string {
  let doi = raw.trim();
  // Strip common URL prefixes
  for (const prefix of [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
  ]) {
    if (doi.toLowerCase().startsWith(prefix)) {
      doi = doi.slice(prefix.length);
      break;
    }
  }
  return doi.toLowerCase();
}

/**
 * Infer a publisher hint from a DOI prefix.
 * Returns null if the prefix is not recognized.
 */
export function publisherFromDoiPrefix(doi: string): string | null {
  const prefix = doi.split("/")[0];
  const map: Record<string, string> = {
    "10.1016": "elsevier",
    "10.1006": "elsevier",
    "10.1053": "elsevier",
    "10.1067": "elsevier",
    "10.1007": "springer",
    "10.1038": "springer",
    "10.1002": "wiley",
    "10.1109": "ieee",
    "10.1145": "acm",
    "10.1371": "plos",
    "10.3389": "frontiers",
    "10.48550": "arxiv",
  };
  return map[prefix] ?? null;
}

/**
 * Generate a filesystem-safe string from a DOI.
 */
export function doiToSafePath(doi: string): string {
  return doi.replace(/[/\\:*?"<>|]/g, "_");
}
