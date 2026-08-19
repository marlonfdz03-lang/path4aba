// Note-uniqueness check (Bug 6, Option C). Extracted pure (no prisma/openai deps) so the "warn but
// NEVER regenerate" contract is unit-testable.
//
// Uniqueness is COSMETIC. It used to trigger a full note REGENERATION (another gpt-4o call) whenever a
// note was too similar to one of the client's recent notes. After the note-language work made the
// function phrasing (and opening/closing/necessity boilerplate) uniform by clinical requirement,
// same-client notes legitimately share far more vocabulary, so that gate began firing repeatedly and
// burning multiple LLM calls per note. Option C: compute the similarity, SURFACE a warning (like the
// coherence/red flags — surface, don't auto-rewrite), and NEVER regenerate. Cosmetic similarity must not
// override a clinical requirement or cost an LLM call. The four COMPLIANCE gates (intervention,
// approved-function, coverage, teaching-method) are unaffected — they detect clinically-defective notes,
// a different category, and still regenerate.

// Threshold raised provisionally to 0.80 to reduce false-positive warnings under the now-required shared
// clinical phrasing. (An operational value, not a validated one.)
export const SIMILARITY_WARN_THRESHOLD = 0.80;

// Jaccard overlap of the two texts' UNIQUE word sets.
export function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Decide what to do about uniqueness. Option C invariant: `regenerate` is ALWAYS false — uniqueness warns,
// it never triggers a regeneration. `warn` is true when the note exceeds the threshold vs any recent note.
export function decideUniqueness(
  note: string,
  previousTexts: string[],
  threshold: number = SIMILARITY_WARN_THRESHOLD,
): { warn: boolean; regenerate: false } {
  const warn = Array.isArray(previousTexts)
    && previousTexts.some((prev) => calculateSimilarity(note, prev) > threshold);
  return { warn, regenerate: false };
}
