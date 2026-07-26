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

// ─────────────────────────────────────────────────────────────────────────────
// PER-BEHAVIOR FUNCTION DERIVATION FROM NOTE PROSE + THE APPROVED-FUNCTION CONSTRAINT.
//
// Kept in this module (not a separate file) so both extract-facts AND generateSmartNote import the
// one implementation, and so the regression test's .ts import resolves without a cross-lib specifier.
//
// THE RULE: a function assigned to a behavior must be a member of that behavior's assessment-approved
// set (clinical_profile.maladaptiveBehaviors[].functions). A function outside the approved set is a
// violation, not a choice. If the derived/written function is unapproved, prefer an approved function
// the antecedent supports; if none fits, leave it blank for review rather than assert an unapproved one.
// ─────────────────────────────────────────────────────────────────────────────

const SEGMENT_STOPWORDS = new Set([
  'the', 'and', 'was', 'were', 'with', 'that', 'this', 'client', 'behavior', 'behaviors',
  'during', 'into', 'from', 'their', 'they', 'them', 'been', 'when', 'which', 'while', 'after',
  'before', 'consistent', 'maintained', 'seeking', 'session', 'appropriate', 'response',
  'responded', 'engaged', 'presented', 'staff', 'adult', 'task', 'used', 'such',
])
export function significantWords(s: string): string[] {
  return ((s || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !SEGMENT_STOPWORDS.has(w))
}

export function splitSentences(note: string): string[] {
  return (note || '').split(/(?<=[.!?])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean)
}

function anchorIndex(hay: string, behavior: any): number {
  const low = hay.toLowerCase()
  for (const raw of [behavior?.topography, behavior?.name, behavior?.evidencedBy]) {
    const needle = String(raw || '').toLowerCase().trim().slice(0, 40)
    if (needle) {
      const idx = low.indexOf(needle)
      if (idx >= 0) return idx
    }
  }
  return -1
}

// Split the note into PER-BEHAVIOR prose segments (each sentence attributed to the behavior whose
// topography/name it best overlaps; a topography-less trailing clause attaches to the most recent).
export function segmentNoteByBehavior(note: string, behaviors: any[]): string[] {
  const sentences = splitSentences(note)
  const kwSets = behaviors.map((b) => new Set([
    ...significantWords(b?.topography), ...significantWords(b?.evidencedBy), ...significantWords(b?.name),
  ]))
  const segments: string[][] = behaviors.map(() => [])
  if (!sentences.length || !behaviors.length) return behaviors.map(() => note || '')

  let last = 0
  for (const sentence of sentences) {
    const words = significantWords(sentence)
    let best = -1
    let bestScore = 0
    kwSets.forEach((kw, bi) => {
      const score = words.reduce((n, w) => n + (kw.has(w) ? 1 : 0), 0)
      if (score > bestScore) { bestScore = score; best = bi }
    })
    if (best >= 0) { segments[best].push(sentence); last = best }
    else { segments[last].push(sentence) }
  }
  return segments.map((arr) => (arr.length ? arr.join(' ') : (note || '')))
}

// A SOCIAL/environmental antecedent — demand/instruction, denied/delayed tangible, attention shift,
// or DIRECTED transition. Its presence is evidence AGAINST an automatic function (sanity rule below).
export const SOCIAL_ANTECEDENT = new RegExp([
  'demand', 'task demand', 'non[- ]preferred',
  'presented with (a |an )?(task|demand|instruction|worksheet|activity|direction)',
  'instruction', 'instructed', 'directed to', 'direction to', 'told to', 'asked to',
  'prompted to', 'request(ed)? to (complete|do|stop|finish|start|begin)',
  'transition (from|to)', 'transition away', 'transitioning (from|to)',
  'clean[- ]?up', 'cleaning up', 'put(ting)? away', 'told .* (ending|ended|to stop|to finish)',
  'denied', 'removed', 'taken away', 'withheld', 'out of reach', 'unavailable', 'restricted',
  'blocked access', 'access .* (denied|removed|restricted|ended)',
  'preferred (item|toy|activity)[^.]{0,30}(denied|removed|delayed|withheld|restricted|unavailable|taken|ended)',
  'attention (was )?(directed|shifted|removed|diverted)', 'attention (to|toward) (another|other)',
  'adult (attention|engaged|attending|turned away)', 'another (person|child|peer|student|adult)',
].join('|'), 'i')

// An AUTOMATIC-consistent antecedent — absence of a social trigger, or an automatic context/timing.
// A DIRECTED transition and a bare activity noun are deliberately NOT here (the bare-noun bug).
export const AUTOMATIC_ANTECEDENT = new RegExp([
  'no (clear |observable )?(external |environmental |social )?antecedent',
  'no (clear |observable )?(social )?(trigger|cue)',
  'absence of (a |clear )?(social|environmental)',
  'unstructured (time|period|activity)', 'independent (activity|engagement|play)',
  'between activities',
  'monotonous', 'repetitive task', '(prolonged |extended )?waiting (period)?',
  'low[- ]stimulation', 'minimal (environmental )?stimulation', 'minimal adult',
  'self[- ]stimulat', 'sensory', 'seated activity',
  'across (all )?conditions', 'regardless of (social )?(consequence|antecedent)',
].join('|'), 'i')

// Derive the function from FUNCTION_PATTERNS over the behavior's PROSE SEGMENT (plus its own fields).
// Returns the resolved label ('Attention'|'Escape'|'Tangibles'|'Automatic Reinforcement'|'unknown'),
// the matched pattern, the raw segment, and any Automatic-vs-social conflict.
export function deriveBehaviorFunction(segment: string, behavior: any):
  { resolved: string; matchedPattern: string | null; segment: string; conflict: { derived: string; antecedent: string } | null } {
  const hay = [
    segment || '',
    behavior?.topography || '', behavior?.evidencedBy || '', behavior?.antecedent || '',
    behavior?.interventions || '', behavior?.result || '',
  ].join('\n')

  const matches: { label: string; index: number; pattern: string }[] = []
  for (const { re, label } of FUNCTION_PATTERNS) {
    const m = re.exec(hay)
    if (m) matches.push({ label, index: m.index, pattern: re.source })
  }

  let resolved = 'unknown'
  let matchedPattern: string | null = null
  if (matches.length === 1) {
    resolved = matches[0].label; matchedPattern = matches[0].pattern
  } else if (matches.length > 1) {
    const anchor = anchorIndex(hay, behavior)
    if (anchor >= 0) matches.sort((a, b) => Math.abs(a.index - anchor) - Math.abs(b.index - anchor))
    resolved = matches[0].label; matchedPattern = matches[0].pattern
  }

  const antecedent = String(behavior?.antecedent || '')
  if (resolved === 'Automatic Reinforcement' && !AUTOMATIC_ANTECEDENT.test(antecedent) && SOCIAL_ANTECEDENT.test(antecedent)) {
    return { resolved: 'unknown', matchedPattern, segment: segment || '', conflict: { derived: 'Automatic Reinforcement', antecedent } }
  }

  return { resolved, matchedPattern, segment: segment || '', conflict: null }
}

// Assessment stores functions as lowercase canonical ('attention'|'escape'|'tangible'|'automatic').
// FUNCTION_PATTERNS / the ABA-Matrix form use display labels. Map between them.
export function functionToCanonical(label: string | null | undefined): string | null {
  const s = String(label || '').toLowerCase()
  if (!s || s === 'unknown') return null
  if (s.includes('attention')) return 'attention'
  if (s.includes('escape') || s.includes('avoidance')) return 'escape'
  if (s.includes('tangible')) return 'tangible'
  if (s.includes('automatic') || s.includes('sensory')) return 'automatic'
  return null
}
const LABEL_BY_CANONICAL: Record<string, string> = {
  attention: 'Attention', escape: 'Escape', tangible: 'Tangibles', automatic: 'Automatic Reinforcement',
}

// Display label for a function value that may be canonical ('escape') or already a label ('Escape').
export function functionDisplayLabel(fn: string): string {
  const c = functionToCanonical(fn)
  return c ? LABEL_BY_CANONICAL[c] : fn
}

export function normalizeApprovedFunctions(approved: string[] | undefined | null): Set<string> {
  const set = new Set<string>()
  for (const a of Array.isArray(approved) ? approved : []) {
    const c = functionToCanonical(a)
    if (c) set.add(c)
  }
  return set
}

export type ConstrainResult = {
  fn: string | null // approved label to use, or null = leave blank for review
  status: 'approved' | 'corrected' | 'unapproved' | 'unconstrained' | 'unknown'
  from?: string // the original candidate when corrected/unapproved
}

// Constrain a candidate function to the behavior's approved set. If the candidate is approved, keep
// it. If not, prefer an approved function the ANTECEDENT supports; if none fits, return null (blank +
// review) rather than assert an unapproved function. With no approved set captured, do not block.
export function constrainFunctionToApproved(
  candidate: string | null | undefined,
  approvedFunctions: string[] | undefined | null,
  antecedent?: string,
): ConstrainResult {
  const approved = normalizeApprovedFunctions(approvedFunctions)
  const cand = functionToCanonical(candidate)
  if (!approved.size) return { fn: candidate ?? null, status: 'unconstrained' }
  if (!cand) return { fn: candidate ?? null, status: 'unknown' } // nothing asserted to constrain
  if (approved.has(cand)) return { fn: LABEL_BY_CANONICAL[cand], status: 'approved' }

  const inferred = functionToCanonical(inferFunctionFromAntecedent(String(antecedent || '')))
  if (inferred && approved.has(inferred)) {
    return { fn: LABEL_BY_CANONICAL[inferred], status: 'corrected', from: LABEL_BY_CANONICAL[cand] }
  }
  return { fn: null, status: 'unapproved', from: LABEL_BY_CANONICAL[cand] }
}
