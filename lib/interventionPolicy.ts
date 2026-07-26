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
  // Long-tail interventions real plans prescribe. Added so the allowlist can NAME them: a procedure
  // the gate cannot name passes by default, which defeats the closed set. Each matches a named
  // procedure or acronym, never a bare noun.
  { canonical: 'Token Economy', re: /token economy|token (?:board|system)/i },
  { canonical: 'Incidental Teaching', re: /incidental teaching/i },
  { canonical: 'Behavioral Skills Training', re: /\bBST\b|behavio(?:u)?ral skills training/i },
  { canonical: 'Chaining', re: /\bchaining\b|(?:forward|backward|total[- ]?task) chaining/i },
  { canonical: 'Task Analysis', re: /task analysis/i },
  { canonical: 'Compliance Training', re: /compliance training/i },
  { canonical: 'Social Skills Training', re: /\bSST\b|social skills training/i },
  { canonical: 'Competing Stimuli', re: /competing stimuli|competing stimulus|matched stimulation/i },
  { canonical: 'Generalization Training', re: /generali[sz]ation training/i },
]

// DELIBERATELY EXCLUDED from the catalog (AGENTS.md bare-noun failure class). Each appears in ordinary
// session prose, so matching it would flag innocent narrative rather than an asserted procedure — the
// same trap that keeps generic "redirection" out of the RIRD entry. Do NOT add any of these without an
// assertion-only pattern that excludes the everyday usage; a bare add WILL flag clean notes:
//   Modeling   — "the RBT modeled the target response"
//   Shaping    — "shaping the client's approximations", "was shaping up"
//   Prompting  — "required additional prompting", "prompt hierarchy"
//   Redirection— "before requiring redirection" (already excluded for RIRD)
//   Choices    — "offered choices", "the client made a choice"
//   Visual Supports / Visual Prompt — "visual supports were available in the room"

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

// ROLE-AWARENESS: the profile separates reduction interventions (approvedInterventions) from skill
// programs (skillAcquisition / replacementBehaviors). A procedure like FCT is a replacement SKILL, so
// it is valid documented as a skill being taught but INVALID documented as a behavior-reduction
// intervention unless it is also an approved reduction intervention. A reduction assertion follows the
// ABC pattern "the RBT implemented [X]"; a skill assertion is a teaching sentence ("targeted X",
// "practiced X"). Conservative on purpose — only a clear implement/reduce cue with no skill cue counts.
const REDUCTION_CUE = /\bimplement(?:ed|s|ing)?\b|\bto (?:reduce|decrease|interrupt|manage)\b/i
const SKILL_CUE = /\btarget(?:ed|ing|s)?\b|\bpractic(?:e|ed|ing|es)\b|\btaught\b|\bteaching\b|\bacquisition\b/i
function assertedAsReductionIntervention(note: string, re: RegExp): boolean {
  for (const sentence of String(note || '').split(/(?<=[.!?;])\s+|\n+/)) {
    if (!re.test(sentence)) continue
    if (SKILL_CUE.test(sentence)) continue // a skill-teaching sentence — not a reduction assertion
    if (REDUCTION_CUE.test(sentence)) return true
  }
  return false
}

// The compliance gate. Returns the interventions the note documents that it must not:
//   prohibited — always disallowed (RIRD, punishment, restraint, …), even with no
//                approved list captured, so the demonstrated RIRD case is caught either way.
//   unapproved — only computed when an approved list IS captured: a catalog intervention the note
//                asserts that is in NEITHER the approved reduction list NOR the skill list.
//   skillAsReduction — a procedure that is a SKILL program (not an approved reduction intervention)
//                but is documented AS a behavior-reduction intervention (e.g. FCT). Role-aware; only
//                computed when a skill list is provided. A skill documented as a skill is NOT flagged.
export function findInterventionViolations(
  note: string,
  approved: string[] | undefined | null,
  skillPrograms?: string[] | undefined | null,
): { detected: string[]; prohibited: string[]; unapproved: string[]; skillAsReduction: string[] } {
  const detected = detectInterventions(note)
  const prohibited = detected.filter((d) => PROHIBITED_INTERVENTIONS.has(d))
  const approvedSet = normalizeApproved(approved)
  const skillSet = normalizeApproved(skillPrograms)
  const unapproved: string[] = []
  const skillAsReduction: string[] = []
  if (approvedSet.size) {
    for (const d of detected) {
      if (PROHIBITED_INTERVENTIONS.has(d) || approvedSet.has(d)) continue // approved reduction — OK
      if (skillSet.has(d)) {
        // It is a skill program, not an approved reduction intervention. Only a violation if the note
        // documents it AS a reduction intervention; documented as a skill, it passes.
        const entry = INTERVENTION_CATALOG.find((e) => e.canonical === d)
        if (entry && assertedAsReductionIntervention(note, entry.re)) skillAsReduction.push(d)
      } else {
        unapproved.push(d)
      }
    }
  }
  return { detected, prohibited, unapproved, skillAsReduction }
}
