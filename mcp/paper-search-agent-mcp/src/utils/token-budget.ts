/**
 * Token budget utilities — advisory only.
 *
 * Provides token estimates so the LLM can decide whether to read
 * full text or request specific sections incrementally.
 * No hard truncation — the LLM manages its own context window.
 */

/** Rough token estimate: ~4 characters per token for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens for each section and compute totals. */
export function estimateSectionTokens(
  sections: Record<string, string>,
): { perSection: Record<string, number>; total: number } {
  const perSection: Record<string, number> = {};
  let total = 0;
  for (const [name, text] of Object.entries(sections)) {
    const est = estimateTokens(text);
    perSection[name] = est;
    total += est;
  }
  return { perSection, total };
}

/**
 * Build an advisory note about token usage relative to budget.
 * Returns null if content is within budget.
 */
export function tokenBudgetAdvisory(
  estimatedTokens: number,
  maxTokens: number,
): string | null {
  if (estimatedTokens <= maxTokens) return null;
  const ratio = (estimatedTokens / maxTokens).toFixed(1);
  return (
    `Content is ~${estimatedTokens} tokens (~${ratio}x the ${maxTokens}-token budget). ` +
    `Consider using get_paper_sections to read specific sections instead of the full text.`
  );
}
