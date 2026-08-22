// Clinical Library helpers (Step 2): the make-or-break dedup key + the PHI discard filter. Pure, no DB, no
// LLM. The ingest step (Step 3) uses these before writing to clinical_library.

// ── canonicalKey: the anti-"diez líneas de tantrum" normalizer ──────────────────────────────────────────
// Collapses casing / punctuation / plurals / generic category suffixes / word order so the same clinical
// concept maps to ONE key: "Tantrum" / "tantrums" / "Tantrum Behavior" / "Behavior Tantrum" / "TANTRUMS"
// → "tantrum". Distinct concepts stay distinct.

// Generic category words carried by names but not identifying the concept — dropped after depluralizing.
const GENERIC_WORDS = new Set(['behavior', 'behaviour', 'response', 'skill', 'program', 'programme', 'procedure']);

// Conservative singular-izer. Leaves -ss/-us/-is/-os endings alone (access, injurious, analysis), maps
// -ies→-y (activities→activity) and -(ch|sh|x|z|s)es→- (boxes→box), else strips a trailing plural -s.
function depluralize(t: string): string {
  if (t.length <= 3) return t;
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (/(ss|us|is|os)$/.test(t)) return t;
  if (/(ch|sh|x|z|s)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

export function canonicalKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')   // strip punctuation (keep word chars, spaces, hyphens)
    .replace(/[-_]/g, ' ')       // hyphen/underscore → space (self-injurious → self injurious)
    .split(/\s+/)
    .filter(Boolean)
    .map(depluralize)
    .filter((t) => t && !GENERIC_WORDS.has(t))
    .sort()                      // word-order independent
    .join(' ')
    .trim();
}

// ── PHI discard filter (Marlon's MODIFIED rules) ────────────────────────────────────────────────────────
// Returns a reason category to DISCARD, or null to KEEP. Numbers are NOT discarded on sight — durations/
// counts ("5 seconds", "2 minutes", "4 trials") are legitimate operational detail. Discard only genuine
// identifiers: dates, ages, embedded proper names, specific locations, and HIPAA-18 patterns. Bias toward
// discarding on ambiguity for these categories (a lost variant is harmless; a stored identifier is not).
export type DiscardReason = 'hipaa-id' | 'date' | 'age' | 'location' | 'proper-name';

// Clinical Title-Case / acronym terms that may legitimately sit mid-prose and must NOT read as proper names.
const CLINICAL_ALLOWLIST = new Set([
  'dra', 'dri', 'dro', 'drl', 'fct', 'ncr', 'dtt', 'net', 'rird', 'aba', 'abc', 'abas',
  'premack', 'momentum', 'modeling', 'modelling', 'chaining', 'prompting', 'shaping', 'extinction',
  'redirection', 'reinforcement', 'attention', 'escape', 'tangible', 'automatic', 'sensory',
  'antecedent', 'consequence', 'differential', 'functional', 'communication', 'training', 'principle',
]);

const MONTHS = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t)?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

export function phiDiscardReason(text: string): DiscardReason | null {
  const s = String(text ?? '');
  if (!s.trim()) return null;

  // 1. HIPAA-18 patterns: email, phone, SSN, MRN, long alphanumeric IDs.
  if (/[\w.+-]+@[\w-]+\.\w{2,}/.test(s)) return 'hipaa-id';                          // email
  if (/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/.test(s)) return 'hipaa-id';                  // SSN
  if (/\b\+?\d[\d\s().-]{7,}\d\b/.test(s) && /\d{3}[-.\s]?\d{4}/.test(s)) return 'hipaa-id'; // phone-ish
  if (/\b(mrn|record|chart|patient|id)\s*#?\s*:?\s*[A-Za-z0-9]{4,}\b/i.test(s)) return 'hipaa-id';
  if (/\b(?=[A-Z0-9-]*\d)[A-Z0-9]{2,}[-]?[A-Z0-9]{4,}\b/.test(s) && /\d/.test(s.replace(/\b\d+\b/g, ''))) return 'hipaa-id'; // MRN-like code (digit+letter mix)

  // 2. DATE: a month adjacent to a day/year, or a numeric date, or a bare 4-digit year. A month word alone
  //    ("may engage", "march across the room") is NOT a date — it needs an adjacent number.
  if (new RegExp(`${MONTHS.source}\\.?\\s+\\d{1,4}`, 'i').test(s)) return 'date';    // "March 3", "Aug 2024"
  if (new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+${MONTHS.source}`, 'i').test(s)) return 'date'; // "3 March"
  if (/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/.test(s)) return 'date';                 // 3/15/24, 08-12
  if (/\b(19|20)\d{2}\b/.test(s)) return 'date';                                     // a year

  // 3. AGE: number + a year/age unit. Duration/count units (second/minute/hour/time/trial) are clinical.
  if (/\b\d{1,3}\s*[-]?\s*(year|yr)s?\s*[-]?\s*old\b/i.test(s)) return 'age';        // "5-year-old", "5 years old"
  if (/\bage[d]?\s*:?\s*\d{1,3}\b/i.test(s)) return 'age';                           // "age 7", "aged 5"
  if (/\b\d{1,2}\s*y[/. ]?o\b/i.test(s)) return 'age';                               // "7 y/o", "7yo"

  // 4. LOCATION: possessive dwellings, street suffixes, school-name patterns.
  if (/'s\s+(house|home|apartment|apt|room|place|residence|classroom)\b/i.test(s)) return 'location';
  if (/\b(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct)\.?\b/i.test(s) && /[A-Z][a-z]+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct)\b/i.test(s)) return 'location';
  if (/\b(elementary|middle school|high school|academy|preschool|daycare|day care|montessori)\b/i.test(s)) return 'location';

  // 5. PROPER NAME: a Capitalized word EMBEDDED in prose (preceded by a lowercase word) that isn't a clinical
  //    term or a month. This catches "hit Marlon", "with Ms Garcia" — but NOT Title-Case runs ("Premack
  //    Principle", "Behavior Momentum") or first-token/acronym names (their capital isn't preceded by a
  //    lowercase word).
  const embedded = s.match(/\b[a-z]+\s+([A-Z][a-zA-Z]{1,})/g);
  if (embedded) {
    for (const m of embedded) {
      const cap = m.split(/\s+/).pop() as string;
      const low = cap.toLowerCase();
      if (CLINICAL_ALLOWLIST.has(low)) continue;
      if (MONTHS.test(cap)) continue; // months handled as dates above (a bare month word is not a name)
      return 'proper-name';
    }
  }

  return null;
}

// ── Extraction (Step 3, pure part) ──────────────────────────────────────────────────────────────────────
// Turn an extracted assessment into candidate library entries, apply the PHI discard filter, and report what
// was discarded (count + reason only). The DB upsert (saveClinicalLibrary) lives in assessmentPipeline.ts.

export type LibraryKind = 'behavior' | 'skill' | 'procedure' | 'reinforcer' | 'activity';
export interface LibraryEntry {
  kind: LibraryKind;
  name: string;
  variants: string[];
  functions: string[];
  meta?: Record<string, unknown>;
}
export interface DiscardRecord { kind: LibraryKind; reason: DiscardReason; }

const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : (v == null || v === '' ? [] : [String(v)]);

// De-duplicate strings case-insensitively, preserving first-seen casing.
export function unionCI(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const t = String(x ?? '').trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function collectLibraryEntries(extracted: any): LibraryEntry[] {
  const e: LibraryEntry[] = [];
  const r = extracted?.reinforcers || {};

  for (const b of extracted?.maladaptiveBehaviors || []) {
    if (!b?.name) continue;
    e.push({ kind: 'behavior', name: String(b.name), variants: b.topography ? [String(b.topography)] : [], functions: asArray(b.function) });
  }
  for (const s of extracted?.replacementSkills || []) {
    if (!s?.name) continue;
    e.push({ kind: 'skill', name: String(s.name), variants: [], functions: s.targetFunction ? [String(s.targetFunction)] : [], meta: s.targetFunction ? { targetFunction: String(s.targetFunction) } : undefined });
  }
  // Teaching procedures = the extracted intervention/procedure NAMES. The assessment does not link a
  // procedure to specific skills, so meta.skills is left empty (a known data gap, not inferred).
  for (const p of extracted?.approvedInterventions || []) {
    if (p) e.push({ kind: 'procedure', name: String(p), variants: [], functions: [] });
  }
  // Reinforcers: tangibles + social. `people` is deliberately EXCLUDED — those are caregiver names (PHI).
  for (const item of [...asArray(r.tangibles), ...asArray(r.social)]) {
    if (item) e.push({ kind: 'reinforcer', name: item, variants: [], functions: [] });
  }
  // Activities: a NEW library consumer for the Builder — does not touch curatedActivities (the note-gen
  // baseline). Setting is recorded when the assessment tied it to home/school.
  for (const a of asArray(r.activities)) if (a) e.push({ kind: 'activity', name: a, variants: [], functions: [] });
  for (const a of extracted?.homeActivities || []) if (a) e.push({ kind: 'activity', name: String(a), variants: [], functions: [], meta: { setting: 'home' } });
  for (const a of extracted?.schoolActivities || []) if (a) e.push({ kind: 'activity', name: String(a), variants: [], functions: [], meta: { setting: 'school' } });
  for (const a of extracted?.preferredActivities || []) if (a) e.push({ kind: 'activity', name: String(a), variants: [], functions: [] });

  return e;
}

// Apply the PHI discard filter per string: a dirty NAME discards the whole entry; a dirty variant is dropped
// (the entry survives with its clean variants). functions are canonical labels (escape/attention/…) — never
// PHI — so they are not filtered. Returns cleaned entries + the discard log (count + reason only).
export function filterLibraryEntries(entries: LibraryEntry[]): { kept: LibraryEntry[]; discards: DiscardRecord[] } {
  const kept: LibraryEntry[] = [];
  const discards: DiscardRecord[] = [];
  for (const entry of entries) {
    const nameReason = phiDiscardReason(entry.name);
    if (nameReason) { discards.push({ kind: entry.kind, reason: nameReason }); continue; }
    const cleanVariants: string[] = [];
    for (const v of entry.variants) {
      const vr = phiDiscardReason(v);
      if (vr) discards.push({ kind: entry.kind, reason: vr });
      else cleanVariants.push(v);
    }
    kept.push({ ...entry, variants: cleanVariants });
  }
  return { kept, discards };
}
