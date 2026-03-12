---
name: fulltext-ingestion
description: >
  Normalizes XML, HTML, PDF, and local attachments into a consistent NormalizedPaperRecord.
  Contains parser selection logic, section segmentation rules, citation extraction guidance,
  and multilingual handling. Use this skill when processing retrieved artifacts into
  structured content for LLM consumption.
---

# fulltext-ingestion

## When to Use

- You have a retrieved artifact (XML, HTML, PDF, or plain text) and need to extract structured content.
- You need to choose the right parser for a given artifact type.
- You need to segment a paper into sections for selective reading.
- You need to handle non-English content (especially Chinese).

## Supported Artifact Types

| Type | Format Examples | Primary Parser |
|---|---|---|
| XML | JATS, Elsevier XML, Europe PMC XML | Built-in XML parser |
| HTML | Publisher HTML pages | Built-in HTML-to-text |
| PDF | Downloaded PDF files | Anthropic PDF skill (default) |
| Plain text | Pre-extracted text | Direct normalization |
| Local attachment | User-provided files | Type detection → appropriate parser |

## PDF Processing Strategy

### Primary: Anthropic PDF Skill
- Leverages Claude's native PDF reading capability.
- Handles complex layouts (double columns, tables, equations, footnotes).
- Best for single-paper processing where LLM interaction is acceptable.

### Future: Local PDF Extraction (Reserved Interface)
- Tools like `marker`, `nougat`, `docling` can be integrated later.
- Preferred for batch processing (cost-conscious) or offline scenarios.
- The system should expose a `parser_override` parameter for future use.

## Section Segmentation

Academic papers typically follow these sections:

| Section | Common Headings |
|---|---|
| Abstract | Abstract, Summary |
| Introduction | Introduction, Background |
| Related Work | Related Work, Literature Review, Prior Work |
| Methods | Methods, Methodology, Materials and Methods, Approach |
| Results | Results, Experiments, Findings |
| Discussion | Discussion, Analysis |
| Conclusion | Conclusion, Conclusions, Summary and Outlook |
| References | References, Bibliography |
| Appendix | Appendix, Supplementary |

For XML (JATS): sections are explicitly tagged — use `<sec>` elements with `sec-type` attributes.
For HTML: use heading hierarchy (`<h1>`–`<h4>`).
For PDF: the Anthropic PDF skill extracts sections based on visual structure.

## Output: NormalizedPaperRecord

```typescript
interface NormalizedPaperRecord {
  metadata: {
    title: string;
    authors: string[];
    doi: string;
    venue: string;
    year: number;
    publisher: string;
    language: string;
  };
  access_record: {
    route_used: string;
    retrieved_at: string;     // ISO timestamp
    artifact_type: string;    // "xml" | "html" | "pdf" | "text"
    source_url: string;
    local_path: string;
  };
  content_format: string;     // original format
  section_map: Record<string, { start: number; end: number }>;
  extracted_text: string;     // full text
  sections: Record<string, string>;  // section_name → text
  references: string[];
  figures_index: string[];
  tables_index: string[];
}
```

## Token Budget Awareness

- **Full paper**: 20k–80k+ tokens. Some review papers exceed 100k.
- **Section-level extraction**: return only requested sections to save context.
- **Abstract-first triage**: for batch screening, provide abstracts first.
- **Chunked delivery**: split very long papers into sequential chunks.

When the LLM requests a paper, consider whether it needs the full text or just specific sections.

## Multilingual Handling

- Detect language from metadata or content sampling.
- Chinese-language papers: ensure the parser supports CJK character extraction.
- If a primary parser fails on non-Latin text, fall back to an alternative parser.
- Tag the `language` field in metadata for downstream processing decisions.

## Citation Extraction

- From XML: parse `<ref-list>` or equivalent elements.
- From HTML: extract from the References section by text pattern.
- From PDF: the Anthropic PDF skill can identify reference sections.
- Normalize citations to include DOI where possible for downstream linking.
