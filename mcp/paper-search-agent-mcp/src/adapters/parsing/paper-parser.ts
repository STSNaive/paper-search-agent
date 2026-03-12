/**
 * Paper parser — extracts structured content from retrieved artifacts.
 *
 * Handles XML (JATS / Elsevier), HTML, and plain text.
 * PDF parsing is delegated to the Anthropic PDF skill (the LLM reads PDFs natively).
 */

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import type { NormalizedPaperRecord } from "../../schemas/index.js";

/**
 * Parse an artifact file into a NormalizedPaperRecord.
 */
export function parsePaper(
  artifactPath: string,
  artifactType?: string,
  metadata?: Partial<NormalizedPaperRecord["metadata"]>,
): NormalizedPaperRecord {
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}`);
  }

  const detectedType = artifactType ?? detectType(artifactPath);
  const raw = readFileSync(artifactPath, "utf-8");

  switch (detectedType) {
    case "xml":
      return parseXml(raw, artifactPath, metadata);
    case "html":
      return parseHtml(raw, artifactPath, metadata);
    case "text":
      return parsePlainText(raw, artifactPath, metadata);
    case "pdf":
      return createPdfPlaceholder(artifactPath, metadata);
    default:
      return parsePlainText(raw, artifactPath, metadata);
  }
}

/**
 * Extract specific sections from a NormalizedPaperRecord.
 */
export function extractSections(
  record: NormalizedPaperRecord,
  sectionNames: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of sectionNames) {
    const lower = name.toLowerCase();
    // Try exact match first, then fuzzy match
    const match = Object.keys(record.sections).find(
      (k) => k.toLowerCase() === lower || k.toLowerCase().includes(lower),
    );
    if (match) {
      result[name] = record.sections[match];
    }
  }
  return result;
}

// ── Parsers ───────────────────────────────────────────────────────

function parseXml(
  raw: string,
  artifactPath: string,
  metadata?: Partial<NormalizedPaperRecord["metadata"]>,
): NormalizedPaperRecord {
  // Lightweight XML parser for JATS and Elsevier XML
  // Uses regex extraction — not a full DOM parser, sufficient for section segmentation.
  const sections: Record<string, string> = {};
  const sectionMap: Record<string, { start: number; end: number }> = {};

  // Extract title
  const title = extractXmlTag(raw, "article-title") ??
    extractXmlTag(raw, "dc:title") ??
    extractXmlTag(raw, "title") ??
    metadata?.title ?? "Untitled";

  // Extract abstract
  const abstract = extractXmlTag(raw, "abstract");
  if (abstract) {
    sections["abstract"] = cleanXmlText(abstract);
  }

  // Extract body sections — JATS style: <sec> elements
  const secRegex = /<sec[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>([\s\S]*?)<\/sec>/gi;
  let match;
  while ((match = secRegex.exec(raw)) !== null) {
    const secTitle = cleanXmlText(match[1]).toLowerCase();
    const secBody = cleanXmlText(match[2]);
    if (secTitle && secBody) {
      sections[secTitle] = secBody;
    }
  }

  // Extract body sections — Elsevier style: <ce:section> / <ce:section-title>
  if (Object.keys(sections).length <= 1) {
    const ceSecRegex = /<ce:section[^>]*>[\s\S]*?<ce:section-title[^>]*>([\s\S]*?)<\/ce:section-title>([\s\S]*?)<\/ce:section>/gi;
    while ((match = ceSecRegex.exec(raw)) !== null) {
      const secTitle = cleanXmlText(match[1]).toLowerCase();
      const secBody = cleanXmlText(match[2]);
      if (secTitle && secBody.length > 50) {
        sections[secTitle] = secBody;
      }
    }
  }

  // If still no structured sections, extract the body as a whole
  if (Object.keys(sections).length <= 1) {
    const body = extractXmlTag(raw, "body") ?? extractXmlTag(raw, "ce:sections");
    if (body) {
      sections["body"] = cleanXmlText(body);
    }
  }

  // Extract references
  const references = extractReferences(raw);

  // Build full text
  const extractedText = Object.values(sections).join("\n\n");

  // Build section map (character offsets)
  let offset = 0;
  for (const [name, text] of Object.entries(sections)) {
    sectionMap[name] = { start: offset, end: offset + text.length };
    offset += text.length + 2; // +2 for \n\n separator
  }

  // Extract authors
  const authors = extractXmlAuthors(raw);

  return {
    metadata: {
      title: typeof title === "string" ? title : "Untitled",
      authors: metadata?.authors ?? authors,
      doi: metadata?.doi ?? extractDoi(raw) ?? null,
      venue: metadata?.venue ?? extractXmlTag(raw, "journal-title") ?? extractXmlTag(raw, "prism:publicationName") ?? null,
      year: metadata?.year ?? extractXmlYear(raw) ?? extractElsevierYear(raw),
      publisher: metadata?.publisher ?? extractXmlTag(raw, "publisher-name") ?? extractXmlTag(raw, "prism:publisher") ?? null,
      language: metadata?.language ?? "en",
    },
    access_record: {
      route_used: "parsed",
      retrieved_at: new Date().toISOString(),
      artifact_type: "xml",
      source_url: null,
      local_path: artifactPath,
    },
    content_format: "xml",
    section_map: sectionMap,
    extracted_text: extractedText,
    sections,
    references,
    figures_index: extractFigures(raw),
    tables_index: extractTables(raw),
  };
}

function parseHtml(
  raw: string,
  artifactPath: string,
  metadata?: Partial<NormalizedPaperRecord["metadata"]>,
): NormalizedPaperRecord {
  // Strip HTML tags for plain text extraction
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    metadata: {
      title: metadata?.title ?? "Untitled",
      authors: metadata?.authors ?? [],
      doi: metadata?.doi ?? null,
      venue: metadata?.venue ?? null,
      year: metadata?.year ?? null,
      publisher: metadata?.publisher ?? null,
      language: metadata?.language ?? "en",
    },
    access_record: {
      route_used: "parsed",
      retrieved_at: new Date().toISOString(),
      artifact_type: "html",
      source_url: null,
      local_path: artifactPath,
    },
    content_format: "html",
    section_map: { body: { start: 0, end: text.length } },
    extracted_text: text,
    sections: { body: text },
    references: [],
    figures_index: [],
    tables_index: [],
  };
}

function parsePlainText(
  raw: string,
  artifactPath: string,
  metadata?: Partial<NormalizedPaperRecord["metadata"]>,
): NormalizedPaperRecord {
  return {
    metadata: {
      title: metadata?.title ?? "Untitled",
      authors: metadata?.authors ?? [],
      doi: metadata?.doi ?? null,
      venue: metadata?.venue ?? null,
      year: metadata?.year ?? null,
      publisher: metadata?.publisher ?? null,
      language: metadata?.language ?? "en",
    },
    access_record: {
      route_used: "parsed",
      retrieved_at: new Date().toISOString(),
      artifact_type: "text",
      source_url: null,
      local_path: artifactPath,
    },
    content_format: "text",
    section_map: { body: { start: 0, end: raw.length } },
    extracted_text: raw,
    sections: { body: raw },
    references: [],
    figures_index: [],
    tables_index: [],
  };
}

function createPdfPlaceholder(
  artifactPath: string,
  metadata?: Partial<NormalizedPaperRecord["metadata"]>,
): NormalizedPaperRecord {
  return {
    metadata: {
      title: metadata?.title ?? "Untitled",
      authors: metadata?.authors ?? [],
      doi: metadata?.doi ?? null,
      venue: metadata?.venue ?? null,
      year: metadata?.year ?? null,
      publisher: metadata?.publisher ?? null,
      language: metadata?.language ?? "en",
    },
    access_record: {
      route_used: "parsed",
      retrieved_at: new Date().toISOString(),
      artifact_type: "pdf",
      source_url: null,
      local_path: artifactPath,
    },
    content_format: "pdf",
    section_map: {},
    extracted_text: `[PDF file at ${artifactPath}. Use the Anthropic PDF skill or read the file directly to extract content.]`,
    sections: {
      _pdf_note: "This PDF has not been text-extracted. Use the Anthropic PDF skill to read it.",
    },
    references: [],
    figures_index: [],
    tables_index: [],
  };
}

// ── XML helpers ───────────────────────────────────────────────────

function extractXmlTag(xml: string, tag: string): string | null {
  // Handle simple tags and tags with attributes
  const simpleTag = tag.replace(/\[.*\]/, "");
  const pattern = new RegExp(`<${simpleTag}[^>]*>([\\s\\S]*?)<\\/${simpleTag}>`, "i");
  const match = pattern.exec(xml);
  return match ? match[1].trim() : null;
}

function cleanXmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractXmlAuthors(xml: string): string[] {
  const authors: string[] = [];
  // JATS style
  const nameRegex = /<name>[\s\S]*?<surname>([\s\S]*?)<\/surname>[\s\S]*?<given-names>([\s\S]*?)<\/given-names>[\s\S]*?<\/name>/gi;
  let match;
  while ((match = nameRegex.exec(xml)) !== null) {
    authors.push(`${cleanXmlText(match[2])} ${cleanXmlText(match[1])}`);
  }
  // Elsevier style: <ce:given-name> and <ce:surname>
  if (authors.length === 0) {
    const ceNameRegex = /<ce:author[^>]*>[\s\S]*?<ce:given-name>([\s\S]*?)<\/ce:given-name>[\s\S]*?<ce:surname>([\s\S]*?)<\/ce:surname>[\s\S]*?<\/ce:author>/gi;
    while ((match = ceNameRegex.exec(xml)) !== null) {
      authors.push(`${cleanXmlText(match[1])} ${cleanXmlText(match[2])}`);
    }
  }
  return authors;
}

function extractXmlYear(xml: string): number | null {
  const yearMatch = /<pub-date[^>]*>[\s\S]*?<year>(\d{4})<\/year>[\s\S]*?<\/pub-date>/i.exec(xml);
  return yearMatch ? parseInt(yearMatch[1], 10) : null;
}

function extractElsevierYear(xml: string): number | null {
  // Elsevier: <prism:coverDate>2020-06-25</prism:coverDate>
  const m = /<prism:coverDate>(\d{4})/i.exec(xml);
  return m ? parseInt(m[1], 10) : null;
}

function extractDoi(xml: string): string | null {
  // JATS: <article-id pub-id-type="doi">...
  const jats = /<article-id[^>]*pub-id-type=["']doi["'][^>]*>([\s\S]*?)<\/article-id>/i.exec(xml);
  if (jats) return jats[1].trim();
  // Elsevier: <prism:doi>10.1016/...</prism:doi>
  const els = /<prism:doi>([\s\S]*?)<\/prism:doi>/i.exec(xml);
  if (els) return els[1].trim();
  // Elsevier: <dc:identifier>doi:10.1016/...</dc:identifier>
  const dc = /<dc:identifier>doi:([\s\S]*?)<\/dc:identifier>/i.exec(xml);
  if (dc) return dc[1].trim();
  return null;
}

function extractReferences(xml: string): string[] {
  const refs: string[] = [];
  // JATS: <mixed-citation>
  const refRegex = /<ref[^>]*>[\s\S]*?<mixed-citation[^>]*>([\s\S]*?)<\/mixed-citation>[\s\S]*?<\/ref>/gi;
  let match;
  while ((match = refRegex.exec(xml)) !== null) {
    refs.push(cleanXmlText(match[1]));
  }
  // Elsevier: <ce:bib-reference> with <ce:textref> or <sb:reference>
  if (refs.length === 0) {
    const ceRefRegex = /<ce:bib-reference[^>]*>[\s\S]*?(?:<ce:textref[^>]*>([\s\S]*?)<\/ce:textref>|<sb:reference[^>]*>([\s\S]*?)<\/sb:reference>)/gi;
    while ((match = ceRefRegex.exec(xml)) !== null) {
      const text = match[1] ?? match[2];
      if (text) refs.push(cleanXmlText(text));
    }
  }
  return refs;
}

function extractFigures(xml: string): string[] {
  const figs: string[] = [];
  const figRegex = /<fig[^>]*>[\s\S]*?<label[^>]*>([\s\S]*?)<\/label>[\s\S]*?(?:<caption[^>]*>([\s\S]*?)<\/caption>)?/gi;
  let match;
  while ((match = figRegex.exec(xml)) !== null) {
    const label = cleanXmlText(match[1]);
    const caption = match[2] ? cleanXmlText(match[2]) : "";
    figs.push(caption ? `${label}: ${caption}` : label);
  }
  return figs;
}

function extractTables(xml: string): string[] {
  const tables: string[] = [];
  const tblRegex = /<table-wrap[^>]*>[\s\S]*?<label[^>]*>([\s\S]*?)<\/label>[\s\S]*?(?:<caption[^>]*>([\s\S]*?)<\/caption>)?/gi;
  let match;
  while ((match = tblRegex.exec(xml)) !== null) {
    const label = cleanXmlText(match[1]);
    const caption = match[2] ? cleanXmlText(match[2]) : "";
    tables.push(caption ? `${label}: ${caption}` : label);
  }
  return tables;
}

function detectType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".xml") return "xml";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".pdf") return "pdf";
  return "text";
}
