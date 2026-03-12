/**
 * NormalizedPaperRecord — the final structured representation of a paper's
 * content, ready for LLM consumption.
 */
export interface NormalizedPaperRecord {
  metadata: {
    title: string;
    authors: string[];
    doi: string | null;
    venue: string | null;
    year: number | null;
    publisher: string | null;
    language: string;
  };
  access_record: {
    route_used: string;
    retrieved_at: string; // ISO 8601
    artifact_type: "xml" | "html" | "pdf" | "text";
    source_url: string | null;
    local_path: string;
  };
  /** Original content format before normalization */
  content_format: string;
  /** Map of section names to character offsets in extracted_text */
  section_map: Record<string, { start: number; end: number }>;
  /** Full extracted text */
  extracted_text: string;
  /** Section name → section text */
  sections: Record<string, string>;
  /** Extracted references list */
  references: string[];
  /** Figure captions or identifiers */
  figures_index: string[];
  /** Table captions or identifiers */
  tables_index: string[];
}

/**
 * TopicCorpusItem — a single entry in a topic-scoped paper corpus.
 */
export interface TopicCorpusItem {
  paper_id: string;
  doi: string | null;
  title: string;
  added_at: string; // ISO 8601
  route_used: string;
  has_fulltext: boolean;
  local_path: string | null;
  notes: string | null;
}
