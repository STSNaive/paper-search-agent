/**
 * Export utility — exports paper records in JSON, CSV, or BibTeX format.
 */

import { writeFileSync } from "node:fs";
import type { NormalizedPaperRecord } from "../../schemas/index.js";
import type { CorpusPaperRef } from "../storage/local-store.js";

export interface ExportOptions {
  format: "json" | "csv" | "bibtex";
  outputPath?: string;
}

/**
 * Export a list of papers/records to the specified format.
 * Returns the formatted string (and optionally writes to file).
 */
export function exportRecords(
  papers: Array<NormalizedPaperRecord | CorpusPaperRef>,
  options: ExportOptions,
): string {
  let output: string;

  switch (options.format) {
    case "json":
      output = JSON.stringify(papers, null, 2);
      break;
    case "csv":
      output = toCsv(papers);
      break;
    case "bibtex":
      output = toBibtex(papers);
      break;
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }

  if (options.outputPath) {
    writeFileSync(options.outputPath, output, "utf-8");
  }

  return output;
}

function toCsv(papers: Array<NormalizedPaperRecord | CorpusPaperRef>): string {
  const rows: string[] = ["doi,title,authors,year,venue"];

  for (const p of papers) {
    if ("metadata" in p) {
      const m = p.metadata;
      rows.push(
        [
          csvEscape(m.doi ?? ""),
          csvEscape(m.title),
          csvEscape(m.authors.join("; ")),
          String(m.year ?? ""),
          csvEscape(m.venue ?? ""),
        ].join(","),
      );
    } else {
      rows.push(
        [csvEscape(p.doi ?? ""), csvEscape(p.title), "", "", ""].join(","),
      );
    }
  }

  return rows.join("\n");
}

function toBibtex(papers: Array<NormalizedPaperRecord | CorpusPaperRef>): string {
  const entries: string[] = [];

  for (const p of papers) {
    if ("metadata" in p) {
      const m = p.metadata;
      const key = generateBibtexKey(m);
      entries.push(
        `@article{${key},\n` +
        `  title = {${m.title}},\n` +
        `  author = {${m.authors.join(" and ")}},\n` +
        (m.year ? `  year = {${m.year}},\n` : "") +
        (m.venue ? `  journal = {${m.venue}},\n` : "") +
        (m.doi ? `  doi = {${m.doi}},\n` : "") +
        `}`,
      );
    } else {
      const key = (p.doi ?? p.paper_id).replace(/[^a-zA-Z0-9]/g, "_");
      entries.push(
        `@article{${key},\n` +
        `  title = {${p.title}},\n` +
        (p.doi ? `  doi = {${p.doi}},\n` : "") +
        `}`,
      );
    }
  }

  return entries.join("\n\n");
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function generateBibtexKey(m: { authors: string[]; year: number | null; title: string }): string {
  const firstAuthor = m.authors[0]?.split(" ").pop() ?? "unknown";
  const year = m.year ?? "nd";
  const word = m.title.split(" ").find((w) => w.length > 3) ?? "paper";
  return `${firstAuthor}${year}${word}`.replace(/[^a-zA-Z0-9]/g, "");
}
