---
name: topic-scoping
description: >
  Translates a natural-language research request into a structured retrieval brief
  with keywords, source priorities, time ranges, and inclusion/exclusion criteria.
  Use this skill when the user provides a research topic, question, or goal and
  you need to decide what to search for and where.
---

# topic-scoping

## When to Use

- The user provides a topic, research question, or problem statement.
- You need to generate search keywords and Boolean queries.
- You need to decide which discovery sources to prioritize.
- You need to set scope parameters (time range, depth, target count).

## Research-Question Framing

1. Identify the **core concept** — what is the user actually asking about?
2. Identify **related concepts** — synonyms, sub-topics, adjacent fields.
3. Determine the **research maturity** — is this an emerging field (recent papers matter more) or an established one (seminal works matter)?
4. Determine the **purpose** — survey, deep-dive, reproduction, comparison, or gap analysis?

## Keyword Expansion

- Start with the user's exact terms.
- Add standard synonyms and abbreviations (e.g., "LLM" ↔ "large language model").
- Add domain-specific terms (e.g., "transformer" in ML vs. electrical engineering).
- Consider MeSH terms for biomedical queries.
- Generate Boolean queries where applicable: `("term A" OR "term B") AND "term C"`.

## Source Prioritization

Match the topic domain to the best discovery sources:

| Domain | Primary Sources | Secondary Sources |
|---|---|---|
| Biomedical | PubMed, Europe PMC | OpenAlex, Scopus |
| CS / AI / ML | arXiv, Semantic Scholar | OpenAlex, Crossref |
| Physics / Math | arXiv | OpenAlex, Crossref |
| Engineering | Scopus | OpenAlex, Crossref |
| General / Multidisciplinary | OpenAlex, Crossref | Scopus, Semantic Scholar |

Always check which sources are enabled in `config.toml` before including them.

## Review Depth Levels

| Level | Description | Target Count | Time Range |
|---|---|---|---|
| Quick scan | Key papers only | 5–15 | Last 3 years |
| Focused review | Core + supporting papers | 15–40 | Last 5–7 years |
| Comprehensive review | Broad coverage + seminal works | 40–100+ | No limit |
| Backfill | Fill gaps in existing corpus | Varies | Targeted |

## Output: SearchBrief

```
topic: <refined topic statement>
keywords: [<list of search terms>]
boolean_query: <optional Boolean string>
time_range: { start_year, end_year } | null
source_priorities: [<ordered source list>]
inclusion_criteria: <what makes a paper relevant>
exclusion_criteria: <what disqualifies a paper>
target_count: <approximate number>
depth: "broad" | "focused" | "backfill"
```
