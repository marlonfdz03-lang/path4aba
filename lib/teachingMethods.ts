// ─────────────────────────────────────────────────────────────────────────────
// TEACHING-METHOD CLOSED SET (Commit 4, Part 1).
//
// A teaching procedure named in a note's replacement-skill prose must be one the client's assessment
// approves — i.e. a member of (clinical_profile.interventions ∩ this teaching-method vocabulary). The
// note-generator's default is to reach for "Modeling"/"DTT" as generic filler regardless of the plan
// (observed live in Felix/Alexandra/Brandon notes: Modeling appears in nearly every note, approved in
// none). That is the same closed-set violation class as interventions and functions — this catches it.
//
// AGENTS.md discipline — match the METHOD as a named procedure, never a bare noun:
//   - "verbal prompting" / "gestural prompts" are prompt LEVELS (derivePromptTypes handles those), NOT
//     the "Prompting" method — generic prompting is deliberately NOT in this vocabulary.
//   - "modeling clay", "the parent will model the skill", "role model" are not the Modeling PROCEDURE —
//     Modeling requires method-asserting context (using/through modeling, "modeling and <supports>",
//     video modeling), never the bare word.
// The regression battery (teachingMethods.test.mjs) locks an innocent-prose set that must stay unmatched.
// ─────────────────────────────────────────────────────────────────────────────

// Each method has TWO matchers:
//   noteRe — detect the method ASSERTED in NOTE prose. For ambiguous words (modeling/chaining/shaping)
//            this REQUIRES method-asserting context so ordinary prose ("modeling clay") stays unmatched.
//   nameRe — classify an assessment INTERVENTION NAME. These are curated procedure names, so the bare
//            word is safe here ("Modeling" as an intervention IS the method). Defaults to noteRe.
export const TEACHING_METHOD_PATTERNS: { canonical: string; noteRe: RegExp; nameRe?: RegExp }[] = [
  { canonical: 'Discrete Trial Training', noteRe: /\bDTT\b|discrete[- ]trial(?:[- ](?:training|teaching|instruction))?/i },
  { canonical: 'Natural Environment Teaching', noteRe: /\bNET\b|natural[- ]environment[- ]teaching/i },
  { canonical: 'Incidental Teaching', noteRe: /incidental teaching/i },
  { canonical: 'Errorless Teaching', noteRe: /errorless (?:teaching|learning)/i },
  { canonical: 'Pivotal Response Training', noteRe: /\bPRT\b|pivotal response (?:training|treatment)/i },
  { canonical: 'Behavioral Skills Training', noteRe: /\bBST\b|behavio(?:u)?ral skills training/i },
  { canonical: 'Functional Communication Training', noteRe: /\bFCT\b|functional communication training/i },
  { canonical: 'Task Analysis', noteRe: /\btask analysis\b/i },
  { canonical: 'Activity Schedule', noteRe: /activity schedul(?:e|es|ing)/i },
  { canonical: 'Hand Over Hand', noteRe: /hand[- ]over[- ]hand/i },
  { canonical: 'Modeling',
    noteRe: /\bvideo[- ]modeling\b|(?:using|through|via|employed|used|by)\s+modeling\b|\bmodeling\b(?=\s+(?:and|with|procedures?|to\s+teach|prompts?|supports?))/i,
    nameRe: /\b(?:video[- ])?modeling\b/i },
  { canonical: 'Chaining',
    noteRe: /\b(?:forward|backward|total[- ]task)[- ]chaining\b|\bchaining\b(?=\s+(?:procedures?|steps|to\s+teach))/i,
    nameRe: /\bchaining\b/i },
  { canonical: 'Shaping',
    noteRe: /\bshaping\b(?=\s+(?:procedures?|the\s+response|by\s+reinforcing|to\s+teach|successive))/i,
    nameRe: /\bshaping\b/i },
]

// The client's APPROVED teaching-method set: the flat clinical_profile.interventions grab-bag narrowed
// to entries that ARE a named teaching method. (Reduction procedures like DRA/DRO and antecedent
// strategies stay out — they are not teaching methods.)
export function approvedTeachingMethods(approvedInterventions: string[] | undefined | null): Set<string> {
  const set = new Set<string>()
  for (const iv of Array.isArray(approvedInterventions) ? approvedInterventions : []) {
    const name = String(iv || '')
    for (const { canonical, noteRe, nameRe } of TEACHING_METHOD_PATTERNS) {
      if ((nameRe || noteRe).test(name)) set.add(canonical)
    }
  }
  return set
}

// Teaching methods NAMED in the note that are OUTSIDE the client's approved set. Empty = clean note.
// When the client has NO classifiable approved method (empty set), we do NOT constrain — same "never
// block on missing data" stance as the function gate, and it avoids false-blocking a client whose
// method was named in a form this vocabulary doesn't yet recognize (that would be an extraction/vocab
// gap, surfaced separately, not silently enforced).
export function findTeachingMethodViolations(
  note: string,
  approvedInterventions: string[] | undefined | null,
): string[] {
  const approved = approvedTeachingMethods(approvedInterventions)
  if (!approved.size) return []
  const text = String(note || '')
  const out: string[] = []
  for (const { canonical, noteRe } of TEACHING_METHOD_PATTERNS) {
    if (noteRe.test(text) && !approved.has(canonical)) out.push(canonical)
  }
  return [...new Set(out)]
}

// The single APPROVED teaching method NAMED in a piece of note prose (Commit 4, Part 2 — the fill copies
// this into the form). Constrained to the approved set, so even an ungated/hand-written note can only
// yield an approved method. Returns null when the prose names no approved method (caller then defaults
// to an approved method or surfaces the config gap). Order follows TEACHING_METHOD_PATTERNS.
export function deriveTeachingMethod(
  text: string,
  approvedInterventions: string[] | undefined | null,
): string | null {
  const approved = approvedTeachingMethods(approvedInterventions)
  if (!approved.size) return null
  const s = String(text || '')
  for (const { canonical, noteRe } of TEACHING_METHOD_PATTERNS) {
    if (noteRe.test(s) && approved.has(canonical)) return canonical
  }
  return null
}
