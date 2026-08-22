// Intervention canonicalizer (STRICT). Maps the many stored spellings of an intervention to ONE canonical id
// so the general function-fit map can match a client's approved list. Profiles store full/variant names
// ("Differential Reinforcement of Alternative Behavior (DRA)"); the map is authored in ids ("DRA").
//
// Why strict / acronym-anchored: DRA, DRI, and DRO differ by a SINGLE word (Alternative / Incompatible /
// Other). Fuzzy word matching would collapse them. The parenthetical acronym is the over-match-safe signal
// that keeps them distinct — it is the PRIMARY key here.
//
// NO AUTOMATIC SEMANTIC ALIASING (Marlon's ruling): terms that merely sound related are NOT unified.
// "Environmental Manipulations" is NOT mapped to "Environmental Modification". If that equivalence should
// exist, it is a human curation decision in the Clinical Library later — never this function's guess.
//
// Neither normalizeInterventionName (phrasing fix-ups) nor canonicalKey (Library token-sort) does this
// (audit confirmed): canonicalKey('DRA')='dra' but 'Differential Reinforcement of Alternative Behavior (DRA)'
// sorts to 'alternative differential dra of reinforcement' — they do not unify.

// Acronyms we accept both in parentheses "(DRA)" and as a standalone token "DRA".
const KNOWN_ACRONYMS = new Set(['DRA', 'DRI', 'DRO', 'DRL', 'DRH', 'FCT', 'NCR', 'DTT', 'RIRD', 'NET']);

// Explicit phrase → id table. Ordered checks below are longest/most-specific first. Keys are lowercased
// substrings; every entry is a deliberate, human-authored equivalence — nothing is inferred.
const PHRASE_TO_ID: Array<[string, string]> = [
  ['non-contingent reinforcement', 'NCR'],
  ['noncontingent reinforcement', 'NCR'],
  ['functional communication training', 'FCT'],
  ['differential reinforcement of alternative', 'DRA'],
  ['differential reinforcement of incompatible', 'DRI'],
  ['differential reinforcement of other', 'DRO'],
  ['behavioral momentum', 'Behavior Momentum'],
  ['behavior momentum', 'Behavior Momentum'],
  ['planned ignoring', 'Planned Ignoring'],
  ['planned ignore', 'Planned Ignoring'],
  ['premack', 'Premack'],
  ['demand fading', 'Demand Fading'],
  ['environmental modification', 'Environmental Modification'],
];

// Return the canonical intervention id for a stored/authored intervention name. Unknown names pass through
// trimmed (a stable id that will simply not match any general-map entry — never force-fitted).
export function canonicalIntervention(name: string): string {
  const raw = String(name ?? '').trim();
  if (!raw) return '';

  // 1. Parenthetical acronym — the strict primary signal, keeps DRA/DRI/DRO distinct.
  const paren = raw.match(/\(([A-Za-z]{2,6})\)/);
  if (paren && KNOWN_ACRONYMS.has(paren[1].toUpperCase())) return paren[1].toUpperCase();

  const lower = raw.toLowerCase();

  // 2. Explicit phrase table (specific first). Deliberate equivalences only — no fuzzy aliasing.
  for (const [phrase, id] of PHRASE_TO_ID) {
    if (lower.includes(phrase)) return id;
  }

  // 3. Standalone acronym token (e.g. "FCT", "FCT training", bare "DRA"). Word-boundary, so it never fires
  //    inside an ordinary word.
  for (const tok of raw.split(/[^A-Za-z]+/)) {
    if (tok && KNOWN_ACRONYMS.has(tok.toUpperCase())) return tok.toUpperCase();
  }

  // 4. Unknown — pass through trimmed. Not force-fitted to any id (Environmental Manipulations lands here,
  //    correctly NOT unified with Environmental Modification).
  return raw;
}
