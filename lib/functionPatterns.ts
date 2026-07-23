// ─────────────────────────────────────────────────────────────────────────────
// FAILURE CLASS: a regex that matches a BARE CLINICAL NOUN which also appears in
// ordinary session prose, and so misclassifies a clinical field.
//
// All four behavior-function patterns originally had this bug:
//   "sensory"    matched sensory play / sensory break / sensory bin (reinforcers)
//   "attention"  matched adult attention / attention to task
//   "avoidance"  matched avoidance of eye contact
//   "tangible" / "access to items" matched tangible reinforcer / access to items
// The result: escape/tangible/attention behaviors whose ABC merely used a sensory
// (or other) reinforcer were all derived as Automatic Reinforcement.
//
// THE RULE (apply everywhere we pattern-match clinical language — function,
// intervention classification, prompt types, behavior topography, etc.):
//   A pattern that DETERMINES a clinical field must match the ASSERTION, not the
//   noun. "attention-maintained" asserts a function; "adult attention" describes
//   a person. Require the function-asserting context (…-maintained/-seeking/
//   -motivated, "maintained by …", "to escape the demand", "demand avoidance",
//   "sensory-maintained", …). Never a bare noun that shows up in reinforcement or
//   activity descriptions.
//
// The regression test (functionPatterns.test.mjs) locks this in: an innocent-prose
// battery must stay unmatched by ALL patterns. Any future pattern change that
// re-introduces a bare-noun match will fail that test.
// ─────────────────────────────────────────────────────────────────────────────

// Behavior-function phrase patterns (tolerant to phrasing variants). Output strings are the
// canonical labels; plan-fill normalizes 'Tangibles' -> the exact ABA Matrix dropdown option.
export const FUNCTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /attention[-\s]?(maintained|seeking|based|motivated)|maintained by (adult |social )?attention|(seeking|to (seek|gain|access|obtain|recruit)) (adult |social )?attention|attention[-\s]function/i, label: 'Attention' },
  { re: /escape[-\s]?(maintained|motivated)|maintained by escape|escape[-\s]function|to escape (a |the )?(demand|task|activity|instruction|situation)|escape[/\s-]avoidance|avoidance[-\s]?(maintained|motivated)|(demand|task)[-\s]avoidance/i, label: 'Escape' },
  { re: /tangible[s]?[-\s]?(maintained|motivated)|maintained by (access to )?tangibles?|tangible[-\s]function|access[-\s]to[-\s]tangibles?/i, label: 'Tangibles' },
  // Require the FUNCTION context — never bare "automatic"/"sensory", which appear in ubiquitous
  // sensory reinforcers/activities (sensory bin, sensory break).
  { re: /automatic[-\s]?(reinforcement|maintained)|automatically[-\s]?maintained|sensory[-\s]?(reinforcement|maintained|stimulation|seeking|input)|self[-\s]?stimulat|stereotyp/i, label: 'Automatic Reinforcement' },
]

// Antecedent -> function FALLBACK. Used ONLY when FUNCTION_PATTERNS return no match: the note always
// states the function, so an 'unknown' means extraction missed it — infer from the antecedent, which
// is clinical evidence in the same note. NEVER a default: an antecedent that matches nothing returns
// null. Order matters: automatic (absence-of-social) is checked first so "no social demand" doesn't
// fall to the broad escape "demand"; then the specific verb-driven social functions (item removed ->
// Tangibles, attention shifted -> Attention); then the broad escape (demand/transition).
export const ANTECEDENT_FUNCTION_PATTERNS: { re: RegExp; label: string }[] = [
  { label: 'Automatic Reinforcement', re: /no (clear |observable )?(social|external|environmental)? ?antecedent|no social (antecedent|trigger|demand)|without (a )?(social )?(demand|antecedent|trigger)|independent (activity|play|engagement)|low[- ]stimulation|unstructured (time|period)|monotonous|repetitive task|self[- ]stimulat/i },
  { label: 'Tangibles', re: /(preferred (item|toy|activity|reinforcer)|item|access|tangible)\b[^.]{0,40}\b(removed|withheld|delayed|denied|restricted|taken away|unavailable|out of reach|ended|blocked)|\b(removed|withheld|delayed|denied|restricted|blocked)\b[^.]{0,40}\b(preferred|item|toy|access|reinforcer)|access (was )?(restricted|denied|removed|delayed|blocked)/i },
  { label: 'Attention', re: /attention (was )?(shifted|directed|diverted|removed|unavailable|redirected|elsewhere)|(shifted|directed|diverted|redirected|removed) (adult |social )?attention|attention (to|toward) (another|other|elsewhere)|adult attention|caregiver('?s)? (conversation|attention)|(caregiver|adult|staff|rbt)[^.]{0,25}(conversation|talking|on the phone)|engaged in (a )?conversation|social (interaction|attention) (removed|withheld|unavailable)|attention (was )?unavailable/i },
  { label: 'Escape', re: /demand|instruction|instructed|directed to|told to|asked to|prompted to|task (was )?present|presented with (a |an )?(task|demand|instruction|non[- ]preferred|worksheet|activity)|non[- ]preferred|clean[- ]?up|put(ting)? away|transition (away )?from a? ?preferred|transition (from|to|away)|move to the next|difficult (or lengthy )?task|work demand|complete (a |the )?task/i },
]

export function inferFunctionFromAntecedent(antecedent: string): string | null {
  const ant = String(antecedent || '')
  if (!ant.trim()) return null
  for (const { re, label } of ANTECEDENT_FUNCTION_PATTERNS) {
    if (re.test(ant)) return label
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-GENERATION COHERENCE: automatic reinforcement is defined by the ABSENCE of a
// social antecedent. A generated clause that ASSERTS an automatic function while ALSO
// describing a social antecedent (a demand, a DIRECTED transition, an item removal, an
// attention shift) is internally contradictory — the exact bug that shipped: "...during
// the transition from a fine motor task..., consistent with automatic reinforcement, as
// no clear social antecedents were identified". Both cannot be true. We FLAG the clause
// for RBT review; we never auto-rewrite it — a wrong function needs a human decision.
//
// Bare-noun discipline (AGENTS.md): "during transitions between activities" is a TIME
// marker (automatic-consistent) and must NOT count as social; "transition from/away from
// a task" is a DIRECTED change (a demand) and must. SOCIAL_CLAUSE_ANTECEDENT below
// requires the directed/asserting form, never the bare word.
const AUTOMATIC_CLAUSE_ASSERTION = /automatic(?:ally)?[-\s]?(?:reinforcement|maintained|reinforced)|no (?:clear |observable )?social antecedent|absence of (?:a |any )?(?:clear )?social antecedent|across all conditions regardless of (?:social )?(?:consequence|antecedent)/i

const SOCIAL_CLAUSE_ANTECEDENT = new RegExp([
  // Demand — must be ASSERTED, never bare: "the/a/task demand", "demand was presented",
  // "presented a demand". Deliberately excludes the NEGATED "no social demand" (which is the
  // automatic assertion itself), so a coherent automatic clause is not mis-flagged.
  '(?:a|the|task|work|academic|non[- ]preferred)[- ]demand',
  'demand (?:was |is )?(?:presented|placed|introduced|given)',
  'presented (?:with )?(?:a |an |the )?demand',
  'instruction', 'instructed', 'directed to', 'told to', 'asked to',
  'prompted to', 'task (?:was )?present',
  'non[- ]preferred', 'clean[- ]?up', 'cleaning up', 'put(?:ting)? away',
  'transition (?:from|away from|to (?:a |the )?(?:non[- ]preferred|structured|less[- ]preferred|table|new|next))',
  'transitioning (?:from|away from)',
  '(?:denied|removed|withheld|delayed|restricted|taken away|out of reach)\\b[^.]{0,30}\\b(?:item|toy|access|activity|reinforcer|tangible)',
  '(?:preferred (?:item|toy|activity))[^.]{0,30}(?:denied|removed|withheld|delayed|restricted|taken|unavailable)',
  'access (?:was )?(?:denied|removed|restricted|delayed)',
  'attention (?:was )?(?:shifted|directed|diverted|removed) (?:to|toward|elsewhere|away)?',
  '(?:shifted|directed|diverted|redirected) (?:adult |social )?attention',
  'adult attention (?:directed|shifted|toward|to another)',
].join('|'), 'i')

function splitClauses(note: string): string[] {
  return String(note || '').split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
}

// Returns a short human-readable flag for each clause that asserts an automatic function
// while also describing a social antecedent. Empty when the note is coherent.
export function findFunctionAntecedentContradictions(note: string): string[] {
  const flags: string[] = []
  for (const clause of splitClauses(note)) {
    if (AUTOMATIC_CLAUSE_ASSERTION.test(clause) && SOCIAL_CLAUSE_ANTECEDENT.test(clause)) {
      const snippet = clause.trim().replace(/\s+/g, ' ').slice(0, 160)
      const flag = `Automatic reinforcement asserted alongside a social antecedent — verify function: "${snippet}${clause.length > 160 ? '…' : ''}"`
      if (!flags.includes(flag)) flags.push(flag)
    }
  }
  return flags
}
