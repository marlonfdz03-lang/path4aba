// ─────────────────────────────────────────────────────────────────────────────
// TREATMENT-PLAN INTERVENTION POLICY (compliance gate — NOT a quality preference).
//
// A session note may document ONLY interventions that appear in the client's
// approved assessment / treatment plan. Documenting an out-of-plan intervention
// records the RBT performing a procedure outside their scope, bills a service the
// authorization does not cover, and exposes the supervising BCBA to liability for
// a plan they did not write. A PROMPT INSTRUCTION IS NOT SUFFICIENT — the model has
// deviated (it generated RIRD despite the positive-intervention constraint), so this
// module is the deterministic gate generateSmartNote enforces before returning a note.
//
// Detection follows the AGENTS.md rule — match the ASSERTED PROCEDURE, not a bare
// noun. "RIRD" / "response interruption" assert the procedure; bare "redirection"
// is ordinary narrative ("completed 3 of 5 pieces before requiring redirection") and
// is deliberately NOT a catalog entry, so generic redirection never trips the gate.
// The regression battery (interventionPolicy.test.mjs) locks both directions in.
// ─────────────────────────────────────────────────────────────────────────────

// Canonical interventions we can detect UNAMBIGUOUSLY in note prose. Each `re` matches
// the named procedure or its acronym — never a bare clinical noun that also appears in
// ordinary session narrative. The closed-set check only ever runs over these canonical
// names, so an intervention we cannot detect without false positives (e.g. generic
// "redirection", "prompting") is intentionally absent and never flagged.
export const INTERVENTION_CATALOG: { canonical: string; re: RegExp }[] = [
  { canonical: 'RIRD', re: /\bRIRD\b|response interruption(?:\s+and\s+redirection)?/i },
  { canonical: 'DRA', re: /\bDRA\b|differential reinforcement of (?:alternative|an alternative)/i },
  { canonical: 'DRI', re: /\bDRI\b|differential reinforcement of (?:incompatible|an incompatible)/i },
  { canonical: 'DRO', re: /\bDRO\b|differential reinforcement of other/i },
  { canonical: 'DRL', re: /\bDRL\b|differential reinforcement of low(?:er)?[- ]?rate/i },
  { canonical: 'FCT', re: /\bFCT\b|functional communication training/i },
  { canonical: 'NCR', re: /\bNCR\b|non[- ]?contingent reinforcement/i },
  { canonical: 'Premack', re: /premack/i },
  { canonical: 'Behavior Momentum', re: /behavior(?:al)? momentum|high[- ]?p(?:robability)?\s+(?:request|sequence)/i },
  { canonical: 'Environmental Modification', re: /environmental modification/i },
  { canonical: 'Planned Ignoring', re: /planned ignor/i },
  { canonical: 'Response Cost', re: /response cost/i },
  { canonical: 'Time Out', re: /\btime[- ]?out\b/i },
  { canonical: 'Overcorrection', re: /overcorrection/i },
  { canonical: 'Restraint', re: /\brestraint\b|physical(?:ly)? restrain/i },
  { canonical: 'Punishment', re: /\bpunishment\b/i },
  { canonical: 'Stimulus Fading', re: /stimulus fading/i },
  { canonical: 'Demand Fading', re: /demand fading/i },
  { canonical: 'Errorless Teaching', re: /errorless (?:teaching|learning)/i },
  { canonical: 'Task Modification', re: /task modification/i },
  { canonical: 'Antecedent Modification', re: /antecedent modification/i },
]

// Interventions that must NEVER appear in a documented ABA session note, regardless of
// whether an approved list was captured for the client. RIRD is included per the
// demonstrated violation; the rest mirror the seeded prohibitedInterventions defaults.
export const PROHIBITED_INTERVENTIONS = new Set<string>([
  'RIRD', 'Response Cost', 'Time Out', 'Overcorrection', 'Restraint', 'Punishment',
])

// Detect which canonical interventions a note ASSERTS. Deduped, in catalog order.
export function detectInterventions(text: string): string[] {
  const t = String(text || '')
  if (!t.trim()) return []
  const found: string[] = []
  for (const { canonical, re } of INTERVENTION_CATALOG) {
    if (re.test(t) && !found.includes(canonical)) found.push(canonical)
  }
  return found
}

// Map a client's approved-intervention list (free-form codes/names from the assessment)
// to the set of canonical catalog keys it covers. An approved entry that matches no
// catalog regex simply contributes nothing here — the closed-set check only compares
// catalog-detectable interventions, so unmatched approved entries never cause a violation.
export function normalizeApproved(approved: string[] | undefined | null): Set<string> {
  const set = new Set<string>()
  const joined = (Array.isArray(approved) ? approved : []).join(' | ')
  if (!joined.trim()) return set
  for (const { canonical, re } of INTERVENTION_CATALOG) {
    if (re.test(joined)) set.add(canonical)
  }
  return set
}

// The compliance gate. Returns the interventions the note documents that it must not:
//   prohibited — always disallowed (RIRD, punishment, restraint, …), even with no
//                approved list captured, so the demonstrated RIRD case is caught either way.
//   unapproved — only computed when an approved list IS captured: a catalog intervention
//                the note asserts that is absent from the client's approved set. With no
//                approved list we cannot know the plan, so we do NOT block every note —
//                only the always-prohibited set applies (documented on the caller side).
export function findInterventionViolations(
  note: string,
  approved: string[] | undefined | null,
): { detected: string[]; prohibited: string[]; unapproved: string[] } {
  const detected = detectInterventions(note)
  const prohibited = detected.filter((d) => PROHIBITED_INTERVENTIONS.has(d))
  const approvedSet = normalizeApproved(approved)
  const unapproved = approvedSet.size
    ? detected.filter((d) => !approvedSet.has(d) && !PROHIBITED_INTERVENTIONS.has(d))
    : []
  return { detected, prohibited, unapproved }
}
