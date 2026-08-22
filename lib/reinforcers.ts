// Pure reinforcer parsing (Bug 2 fix), extracted so it can be unit-tested (no prisma/pdf deps).
// The LLM returns each reinforcer category as EITHER an array of discrete items (the new prompt) OR a
// prose string ("Preferred food items such as strawberries, cookies, and pizza; 'Great job'"). A naive
// comma-split shreds the prose into garbage ("Preferred food items such as strawberries", "and pizza",
// "'Nice work"). This parses BOTH: prefer array items; for a string, split on , ; newlines, then per
// fragment take the part after "such as" (drops the category prefix), strip leading conjunctions and
// stray quotes, and drop empties/stopwords.

const REINFORCER_STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'etc', 'other', 'others', 'such as', 'including', 'items', 'item',
]);

// Clean ONE fragment (an array item, or a comma-split piece of a prose string).
function cleanFragment(frag: unknown): string {
  let s = String(frag ?? '').trim();
  const m = s.match(/\bsuch as\b(.*)$/i); // "X such as Y" -> "Y" (drops the category prefix)
  if (m) s = m[1];
  s = s.replace(/['"]/g, ''); // stray quotes
  s = s.replace(/^[\s.,;:()\-]+/, ''); // leading punctuation/space
  s = s.replace(/^(?:and|or|as well as|including|like|e\.g\.)\b[\s:.\-]*/i, ''); // leading filler word
  s = s.replace(/[\s.,;:()\-]+$/, '').trim(); // trailing punctuation
  return s;
}

export function splitReinforcerValue(value: unknown): string[] {
  // Uniform handling: array items AND prose strings are both split on , ; newlines, then each fragment is
  // cleaned. An array item can still be prose ("brief community outings such as mall walks"), so array
  // entries must be cleaned too — not passed through raw.
  const parts = Array.isArray(value) ? value.map((v) => String(v)) : [String(value ?? '')];
  return parts
    .flatMap((part) => part.split(/[,;\n]/))
    // " or " denotes ALTERNATIVES ("tablet or phone") — resolve them into discrete items so the note can
    // name ONE reinforcer, never an unresolved "(tablet or phone)". Split on " or " ONLY (whitespace on
    // both sides so it's a standalone token, not the "or" inside a word). NEVER split " and " — " and "
    // joins compound items ("arts and crafts", "kinetic sand and bin") that must stay whole.
    .flatMap((frag) => frag.split(/\s+or\s+/i))
    .map(cleanFragment)
    .filter((s) => s.length >= 2 && !REINFORCER_STOPWORDS.has(s.toLowerCase()));
}

// Parse the reinforcers object { tangibles, activities, social, people } into a flat, deduped item list.
// The `people` category is DELIBERATELY EXCLUDED: those are caregiver names (e.g. "Mother"), and a person who
// DELIVERS reinforcement is not a reinforcement ITEM — including them leaks a name into the reinforcer catalog
// (and is PHI-adjacent). This matches the Clinical Library collector, which already excludes `people`.
export function parseReinforcers(reinforcers: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of ['tangibles', 'activities', 'social']) {
    for (const item of splitReinforcerValue(reinforcers?.[key])) {
      const k = item.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(item); }
    }
  }
  return out;
}
