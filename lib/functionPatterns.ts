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

import { INTERVENTION_CATALOG } from './interventionPolicy.ts'

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

// The intervention clause opens with "the RBT [verb]…" — the grammar anchor for where the intervention
// begins, used alongside the named-intervention catalog so position can be checked even when the named
// procedure isn't in the catalog.
const RBT_INTERVENTION_CLAUSE = /\bthe RBT\s+(implemented|provided|delivered|applied|used|redirected|prompted|initiated|introduced|offered)\b/i

// Earliest character index where a documented-function pattern matches `text`, or -1 if none. Patterns are
// case-insensitive and NON-global, so exec is stateless.
export function documentedFunctionIndex(text: string): number {
  const s = String(text || '')
  let min = -1
  for (const { re } of FUNCTION_PATTERNS) {
    const m = re.exec(s)
    if (m && (min < 0 || m.index < min)) min = m.index
  }
  return min
}

// Earliest character index of the intervention clause in `text` — the first named intervention
// (INTERVENTION_CATALOG) OR the "the RBT [verb]…" grammar anchor — or -1 if the intervention can't be
// located (in which case position cannot be verified and the caller falls back to presence).
export function interventionAnchorIndex(text: string): number {
  const s = String(text || '')
  let min = -1
  for (const { re } of INTERVENTION_CATALOG) {
    const m = re.exec(s)
    if (m && (min < 0 || m.index < min)) min = m.index
  }
  const g = RBT_INTERVENTION_CLAUSE.exec(s)
  if (g && (min < 0 || g.index < min)) min = g.index
  return min
}

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
  { label: 'Escape', re: /demand|instruction|instructed|directed to|told to|asked to|prompted to|task (was )?present|presented with (a |an )?(task|demand|instruction|non[- ]preferred|worksheet|activity)|non[- ]preferred|clean[- ]?up|put(ting)? away|transition (away )?from a? ?preferred|transition (from|to|away)|move to the next|difficult (or lengthy )?task|work demand|complete (a |the )?task|(?:fine|gross)[- ]?motor task|(?:presented with|during|completing|working on|engaged in|introduced to) (?:a |an |the )?[a-z]+(?:[- ][a-z]+)? task\b/i },
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

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION-COVERAGE GATE (Bug 3). SEPARATE from the approved-set (validity) gate: this checks that EACH
// ABC actually STATES a documented function IN ITS PROSE (RULE A: every ABC names its function). The
// validity gate only asks "is the stated function approved?" — it is blind to an ABSENT function, so a
// note with 1/5 ABCs naming a function passes validity. This gate closes that hole.
//
// Segmentation (never let SKILL prose satisfy an ABC):
//   - Behavior anchors: keyword overlap of each behavior's name+topography against the note's sentences
//     (the note REWORDS the stored topography, so raw substring is too brittle — overlap is robust).
//   - ABC_i (i<N) window = anchor_i → anchor_{i+1} (anchors sorted by position).
//   - ABC_N end = the FIRST replacement-skill anchor AFTER the last behavior anchor. Skill NAMES are data
//     (mandated verbatim in the note), so a RAW SUBSTRING match is safe and phrase-independent — it keys
//     on the skill name, not the transition wording. This excludes the entire skill-acquisition paragraph
//     from ABC_N, so skill prose can never satisfy ABC_N's function check.
//   - Fallback ladder: skill-anchor → transition-marker whitelist → neither ⇒ segmentable=false (FAIL
//     LOUD). NEVER anchor_N → end of note as a silent pass.
//   - A behavior with no anchor FAILS ("couldn't locate its ABC") — never a silent pass.
//
// Presence is measured over the PROSE ALONE via deriveBehaviorFunction(window, {}) — the empty behavior
// means metadata (stored topography/antecedent/function) is NOT consulted; only what the ABC text says.

// Secondary fallback ONLY (skill-anchor is primary): the skill-acquisition paragraph openers the prompt
// mandates. Used to find ABC_N's end when no skill name is anchorable.
const SKILL_TRANSITION_MARKERS = new RegExp([
  'in addition to behavior[- ]reduction programming',
  'skill[- ]acquisition programming',
  'skill acquisition (?:section|paragraph|programming|focused|targeted)',
  'programming also addressed',
  'the session then targeted the replacement program',
  'structured opportunities targeting',
  'replacement program for',
].join('|'), 'i')

export type FunctionCoverage = {
  segmentable: boolean
  missing: { name: string }[]
  results: { name: string; present: boolean }[]
}

// For each ABC (one per behavior), does its PROSE name a documented function? Returns the per-behavior
// results, the subset missing a function, and whether the note could be segmented at all. `skillNames`
// marks where the ABC body ends (the skill-acquisition paragraph) — pass
// input.replacementSkillsAddressed[].name plus activePrograms.replacementSkills.
// Anchor each behavior to where its ABC begins, and find the boundary where the skill/replacement section
// starts. SHARED by findMissingFunctionABCs (which windows each ABC) and the whole-note drift record (which
// bounds its scan to the ABC section, before the skill prose). Returns null when the note can't be anchored or
// the ABC-section end can't be located — the coverage check treats that as unsegmentable ("fail loud").
export interface AbcSegmentation { anchored: { i: number; pos: number }[]; skillBoundary: number }
export function abcSegmentation(note: string, behaviors: any[], skillNames: string[] = []): AbcSegmentation | null {
  if (!note || !Array.isArray(behaviors) || !behaviors.length) return null
  const noteL = note.toLowerCase()
  const sents = splitSentences(note)
  if (!sents.length) return null

  // Sentence offsets in the original note (splitSentences trims/filters, so recover positions by scan).
  let cursor = 0
  const offsets = sents.map((s) => {
    const idx = note.indexOf(s, cursor)
    const at = idx >= 0 ? idx : cursor
    cursor = at + s.length
    return at
  })

  // Behavior anchor = offset of the FIRST sentence this behavior best-matches (keyword overlap, score>0).
  const behKw = behaviors.map((b) => new Set([
    ...significantWords(b?.name), ...significantWords(b?.topography),
  ]))
  const anchors: number[] = behaviors.map(() => -1)
  sents.forEach((s, si) => {
    const words = significantWords(s)
    let best = -1
    let bestScore = 0
    behKw.forEach((kw, bi) => {
      const score = words.reduce((n, w) => n + (kw.has(w) ? 1 : 0), 0)
      if (score > bestScore) { bestScore = score; best = bi }
    })
    if (best >= 0 && anchors[best] < 0) anchors[best] = offsets[si]
  })

  const anchored = anchors
    .map((pos, i) => ({ i, pos }))
    .filter((a) => a.pos >= 0)
    .sort((a, b) => a.pos - b.pos)

  // No behavior could be located at all → degenerate, fail loud.
  if (!anchored.length) return null

  // ABC_N end = first skill-name occurrence AFTER the last behavior anchor (raw substring; skill names are
  // mandated verbatim). Fallback to the transition-marker whitelist; else unsegmentable (fail loud).
  const lastAnchor = anchored[anchored.length - 1].pos
  let skillBoundary = Infinity
  for (const raw of skillNames || []) {
    const n = String(raw || '').trim().toLowerCase()
    if (n.length < 3) continue
    const idx = noteL.indexOf(n, lastAnchor + 1)
    if (idx >= 0 && idx < skillBoundary) skillBoundary = idx
  }
  if (skillBoundary === Infinity) {
    const m = SKILL_TRANSITION_MARKERS.exec(note.slice(lastAnchor + 1))
    if (m) skillBoundary = lastAnchor + 1 + m.index
  }
  if (skillBoundary === Infinity) return null // could not find ABC_N end → fail loud, never scan to end
  return { anchored, skillBoundary }
}

// The char index where the ABC section ends and the skill/replacement section begins, or null when the note
// can't be segmented. Thin accessor over abcSegmentation for callers that only need the boundary.
export function abcSectionBoundary(note: string, behaviors: any[], skillNames: string[] = []): number | null {
  return abcSegmentation(note, behaviors, skillNames)?.skillBoundary ?? null
}

export function findMissingFunctionABCs(note: string, behaviors: any[], skillNames: string[] = []): FunctionCoverage {
  const empty: FunctionCoverage = { segmentable: false, missing: [], results: [] }
  const seg = abcSegmentation(note, behaviors, skillNames)
  if (!seg) return empty
  const { anchored, skillBoundary } = seg

  // Window each anchored behavior and check the PROSE for a documented function that is CORRECTLY PLACED —
  // present AND before the intervention clause (Problem 2). A function absent, or relocated after the
  // intervention (e.g. attached to the client's response by a retry), fails and regenerates. When the
  // intervention clause can't be located in the window, we can't verify order, so we fall back to presence.
  const present: boolean[] = behaviors.map(() => false)
  anchored.forEach((a, j) => {
    const end = j < anchored.length - 1 ? anchored[j + 1].pos : skillBoundary
    const window = note.slice(a.pos, end)
    const fIdx = documentedFunctionIndex(window)
    if (fIdx < 0) { present[a.i] = false; return }               // function absent
    const iIdx = interventionAnchorIndex(window)
    present[a.i] = iIdx < 0 ? true : fIdx < iIdx                  // must precede the intervention clause
  })

  const results = behaviors.map((b, i) => ({ name: String(b?.name || ''), present: present[i] }))
  const missing = results.filter((r) => !r.present).map((r) => ({ name: r.name }))
  return { segmentable: true, missing, results }
}

// DRIFT RECORD signal — admin-only, record-only. Which canonical functions are NAMED in `text` but are NOT in
// the set preselect ASSIGNED for this note. Reuses FUNCTION_PATTERNS (the note's own function vocabulary) and
// functionToCanonical — NO new patterns. The caller bounds `text` to the ABC section (note.slice(0,
// abcSectionBoundary)) so skill-section prose ("initiated appropriate attention-seeking interactions") is
// excluded — that boundary is what removes the prosocial false positives.
//
// THREE LIMITATIONS — read before reading the number:
//  - BLIND SPOT: 17% of notes assign all four functions, so the check can never fire on them. The union grows
//    with behavior count (avg 1.4 at 1-2 behaviors, 3.7 at 7+), so this UNDERCOUNTS systematically on large
//    notes — exactly where drift is worst. A future drop in this metric may mean notes got bigger, not that
//    drift improved.
//  - PRECISION: ~85%, from 13 hits hand-classified on 2026-09-05. Indicative, not a measurement.
//  - NOTE-LEVEL, not per-behavior: it does not attribute drift to a specific behavior.
export function functionsOutsideAssignedSet(text: string, assigned: string[]): string[] {
  const set = new Set(assigned)
  const out = new Set<string>()
  for (const { re, label } of FUNCTION_PATTERNS) {
    if (re.test(text)) {
      const c = functionToCanonical(label)
      if (c && !set.has(c)) out.add(c)
    }
  }
  return [...out]
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
  fn: string | null // function label to use, or null = leave blank for review
  // approved: candidate already in the effective set. corrected: swapped for an antecedent-supported
  // member. defaulted: neither the written function nor the antecedent picked a member, so the sole/
  // primary recordable approved function was filled (flag for review). not_in_matrix: the assessment
  // approves function(s) but the client's ABA Matrix dropdown records NONE of them (config gap; blank).
  // unconstrained: no approved set captured, nothing to enforce. unknown: nothing asserted and no set.
  status: 'approved' | 'corrected' | 'defaulted' | 'not_in_matrix' | 'unconstrained' | 'unknown'
  from?: string // the original candidate when corrected/defaulted
  unrecordable?: string[] // approved functions the matrix cannot record (config-gap detail)
}

// The EFFECTIVE set of functions a behavior may be assigned: the assessment-approved set, narrowed to
// what the client's captured ABA Matrix dropdown can actually record. The catalog is captured by the
// extension at fill time, so MOST clients (every first note, every un-filled client) have none — when
// it is absent we do NOT narrow (effective = approved), so the constraint never regresses a client
// without a catalog. Both inputs are the client's OWN data; nothing here is client- or behavior-specific.
export function effectiveAllowedFunctions(
  approvedFunctions: string[] | undefined | null,
  matrixFunctions?: string[] | undefined | null,
): { allowed: Set<string>; approved: Set<string>; matrixKnown: boolean } {
  const approved = normalizeApprovedFunctions(approvedFunctions)
  const matrixKnown = Array.isArray(matrixFunctions) && matrixFunctions.length > 0
  if (!matrixKnown) return { allowed: approved, approved, matrixKnown: false }
  const matrix = normalizeApprovedFunctions(matrixFunctions)
  // Set iteration preserves insertion order, so `allowed` keeps the assessment's function order —
  // used to pick a deterministic "primary" when we must default.
  const allowed = new Set([...approved].filter((f) => matrix.has(f)))
  return { allowed, approved, matrixKnown: true }
}

// The client's captured ABA-Matrix catalog is PER-BEHAVIOR: each behavior's "What was the function?"
// dropdown can offer a different option set (Distractibility → {Automatic Reinforcement, Escape};
// another behavior → {Attention, Escape, Tangibles}). `functionsByBehavior` holds each behavior's own
// dropdown; `functions` is the legacy GLOBAL UNION across all of them. Resolve a behavior's dropdown to
// its OWN list when present, else fall back to the union. BACKWARD COMPAT: every client captured before
// per-behavior existed has only `functions` (no `functionsByBehavior`), so the fallback fires for every
// behavior — byte-for-byte the pre-per-behavior behavior, no regression. The name match mirrors
// extract-facts' approvedFunctionsFor: exact (case-insensitive) first, then a loose contains match.
export function matrixFunctionsForBehavior(
  catalog: { functions?: string[]; functionsByBehavior?: Record<string, string[]> } | null | undefined,
  behaviorName: string,
): string[] | undefined {
  const union =
    Array.isArray(catalog?.functions) && catalog!.functions!.length ? catalog!.functions : undefined
  const byBehavior = catalog?.functionsByBehavior
  if (byBehavior && typeof byBehavior === 'object') {
    const key = String(behaviorName || '').trim().toLowerCase()
    if (key) {
      const entries = Object.entries(byBehavior).filter(
        ([, v]) => Array.isArray(v) && v.length,
      ) as [string, string[]][]
      const exact = entries.find(([k]) => String(k).trim().toLowerCase() === key)
      if (exact) return exact[1]
      const loose = entries.find(([k]) => {
        const kk = String(k).trim().toLowerCase()
        return kk && (key.includes(kk) || kk.includes(key))
      })
      if (loose) return loose[1]
    }
  }
  return union
}

// Constrain a candidate function to the behavior's EFFECTIVE set (approved ∩ ABA-Matrix dropdown).
// Keep the candidate if it is in the set; else prefer a member the ANTECEDENT supports; else fill the
// sole/primary member (the field is mandatory in the host form — a blank traps the RBT), flagged for
// review. If the assessment approves function(s) but the matrix records none, that is a CONFIG GAP: we
// blank and flag it for the BCBA/admin, never silently. With no approved set captured, do not block.
export function constrainFunctionToApproved(
  candidate: string | null | undefined,
  approvedFunctions: string[] | undefined | null,
  antecedent?: string,
  matrixFunctions?: string[] | undefined | null,
): ConstrainResult {
  const { allowed, approved, matrixKnown } = effectiveAllowedFunctions(approvedFunctions, matrixFunctions)
  if (!approved.size) return { fn: candidate ?? null, status: 'unconstrained' }

  // Config gap: assessment approves function(s), but the client's ABA Matrix offers none of them.
  if (matrixKnown && allowed.size === 0) {
    return { fn: null, status: 'not_in_matrix', unrecordable: [...approved].map((c) => LABEL_BY_CANONICAL[c]) }
  }

  const cand = functionToCanonical(candidate)
  if (cand && allowed.has(cand)) return { fn: LABEL_BY_CANONICAL[cand], status: 'approved' }

  const inferred = functionToCanonical(inferFunctionFromAntecedent(String(antecedent || '')))
  if (inferred && allowed.has(inferred)) {
    return { fn: LABEL_BY_CANONICAL[inferred], status: 'corrected', from: cand ? LABEL_BY_CANONICAL[cand] : undefined }
  }

  // Never-blank last resort: fill the primary recordable approved function (sole member when the set is
  // a singleton — forced, unambiguous), flagged so the RBT verifies. `allowed` is non-empty here.
  const primary = [...allowed][0]
  return { fn: LABEL_BY_CANONICAL[primary], status: 'defaulted', from: cand ? LABEL_BY_CANONICAL[cand] : undefined }
}
