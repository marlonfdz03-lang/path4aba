import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import OpenAI from 'openai'

// New diagnostics are gated behind this flag (default false) so nothing is logged in
// production. No field VALUES (PHI) are ever logged even when true — counts/labels only.
const DEBUG = false

// ── Shared clinical vocabulary ───────────────────────────────────────────────
// Single source of truth for the term lists the deterministic inference below matches
// against. Extend a list here and every inference rule picks it up — no logic changes.
const VOCAB = {
  // Procedures delivered BEFORE the behavior (antecedent-based).
  antecedentProcedures: [
    'behavior momentum', 'behavioral momentum', 'high-probability request', 'high-p request',
    'high-p sequence', 'high probability request', 'high-probability', 'high probability', 'high-p',
    'ncr', 'non-contingent reinforcement', 'noncontingent reinforcement', 'premack',
    'environmental modification', 'priming', 'pre-teaching', 'pre teaching', 'preteaching',
    'choice provision', 'task modification', 'structured antecedent', 'visual schedule',
    'visual support', 'visual supports', 'antecedent intervention', 'antecedent-based',
    'antecedent strategy', 'antecedent strategies',
  ],
  // Procedures delivered AFTER the behavior (consequence-based).
  consequenceProcedures: [
    'dra', 'differential reinforcement of alternative', 'dri',
    'differential reinforcement of incompatible', 'fct', 'functional communication training',
    'planned ignoring', 'extinction',
  ],
  // Any of these in a goal's text means prompts were used.
  promptIndicators: [
    'prompt', 'prompting', 'prompted', 'verbal prompt', 'gestural', 'model', 'modeling',
    'modeled', 'physical guidance', 'hand-over-hand', 'hand over hand', 'with support',
    'with assistance',
  ],
  // Any of these means the response was independent.
  independenceIndicators: [
    'independently', 'without prompts', 'without prompting', 'unprompted', 'no prompts',
    'independent',
  ],
  // A REPORTABLE event (separate incident report). A treatment-plan behavior handled with
  // planned interventions is NOT an incident — it belongs in Behavior Reduction, not here.
  incidentIndicators: [
    'injury', 'injured', 'first aid', 'medical attention', 'emergency', 'hospital',
    'bleeding', 'property damage', 'left the premises', 'elopement', 'eloped', 'incident report',
  ],
} as const

// Behavior-function phrase patterns (tolerant to phrasing variants). Output strings are the
// canonical labels; plan-fill normalizes 'Tangibles' -> the exact ABA Matrix dropdown option.
const FUNCTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /attention[-\s]?(maintained|seeking|based)?/i, label: 'Attention' },
  { re: /escape[-\s]?(maintained|motivated)?|avoidance|demand[-\s]avoidance/i, label: 'Escape' },
  { re: /tangible[s]?[-\s]?(maintained|access)?|access[-\s]to[-\s]items?/i, label: 'Tangibles' },
  { re: /automatic[-\s]?(maintained|reinforcement)?|sensory|self[-\s]stimulat/i, label: 'Automatic Reinforcement' },
]

type ThreeState = true | false | 'unknown'

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// True if `text` contains any of `terms` as a whole token (word-bounded), case-insensitive.
// Word boundaries stop short tokens (dra/dri/ncr/fct) matching inside larger words.
function containsAny(text: string, terms: readonly string[]): boolean {
  const hay = (text || '').toLowerCase()
  if (!hay.trim()) return false
  return terms.some((t) => new RegExp(`(^|[^a-z0-9])${esc(t.toLowerCase())}([^a-z0-9]|$)`, 'i').test(hay))
}

// Locate this behavior in the note so the function match can be anchored to it. Returns the
// index of the topography (preferred) / name / evidencedBy within `hay`, or -1 if none found.
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

// Split a note into sentences (also breaking on newlines/semicolons).
function splitSentences(note: string): string[] {
  return (note || '').split(/(?<=[.!?])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean)
}

// Significant (topography-ish) words used to attribute a sentence to a behavior. Lowercased,
// >=4 chars, minus common clinical/filler words so generic terms don't cause misattribution.
const SEGMENT_STOPWORDS = new Set([
  'the', 'and', 'was', 'were', 'with', 'that', 'this', 'client', 'behavior', 'behaviors',
  'during', 'into', 'from', 'their', 'they', 'them', 'been', 'when', 'which', 'while', 'after',
  'before', 'consistent', 'maintained', 'seeking', 'session', 'appropriate', 'response',
  'responded', 'engaged', 'presented', 'staff', 'adult', 'task', 'used', 'such',
])
function significantWords(s: string): string[] {
  return ((s || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !SEGMENT_STOPWORDS.has(w))
}

// Issue 2 fix: split the note into PER-BEHAVIOR prose segments. Each sentence is attributed to
// the behavior whose extracted keywords (topography/evidencedBy/name) it best overlaps; a
// sentence with no overlap (e.g. a trailing "...consistent with X-maintained behavior" clause
// that repeats no topography words) is attached to the most recently attributed behavior. This
// keeps each behavior's function phrase in its OWN segment instead of running every pattern over
// the whole note (which cross-contaminates when the LLM's topography isn't verbatim in the note).
function segmentNoteByBehavior(note: string, behaviors: any[]): string[] {
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
  // A behavior that captured no sentence falls back to the whole note (better a shot than blank).
  return segments.map((arr) => (arr.length ? arr.join(' ') : (note || '')))
}

// A SOCIAL/environmental antecedent — a demand or instruction, a denied/delayed tangible, a shift
// in adult attention, or a DIRECTED transition. Kept to clear FUNCTIONAL triggers (not bare words
// like "task"/"transition", which also appear in automatic-context antecedents like "during a
// repetitive task"). Its presence is evidence AGAINST an automatic function.
const SOCIAL_ANTECEDENT = new RegExp([
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

// An AUTOMATIC-consistent antecedent — one describing the ABSENCE of a social trigger, or an
// automatic CONTEXT/timing (a repetitive task, a plain transition period, sensory/independent
// activity). If present, an automatic derivation is coherent and the sanity rule does NOT fire.
const AUTOMATIC_ANTECEDENT = new RegExp([
  'no (clear |observable )?(external |environmental |social )?antecedent',
  'no (clear |observable )?(social )?(trigger|cue)',
  'absence of (a |clear )?(social|environmental)',
  'unstructured (time|period|activity)', 'independent (activity|engagement|play|work)',
  'during (a )?transition', 'between activities',
  'monotonous', 'repetitive task', '(prolonged |extended )?waiting (period)?',
  'low[- ]stimulation', 'minimal (environmental )?stimulation', 'minimal adult',
  'self[- ]stimulat', 'sensory', 'quiet (independent )?work', 'seated activity', 'fine motor',
  'across (all )?conditions', 'regardless of (social )?(consequence|antecedent)',
].join('|'), 'i')

// Rule 6: derive the function from tolerant patterns run over the behavior's PROSE SEGMENT (plus
// the behavior's own fields as backup). If more than one pattern matches, take the one whose match
// index is closest to the topography. If none match, 'unknown'. Returns the resolved label, which
// pattern matched (regex source), the raw segment, and any clinical conflict (see the sanity rule).
function deriveBehaviorFunction(segment: string, behavior: any):
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
    // Deterministic tiebreak when there's no topography anchor: FUNCTION_PATTERNS order.
    resolved = matches[0].label; matchedPattern = matches[0].pattern
  }

  // CLINICAL SANITY RULE (applied AFTER pattern matching): automatic reinforcement is defined by
  // the ABSENCE of a social antecedent. If the patterns resolved to Automatic Reinforcement but the
  // antecedent clearly describes a social event, the matcher likely grabbed text from the wrong
  // behavior — do NOT write a clinically incoherent function. Return 'unknown' and flag the
  // conflict (derived function + antecedent) for review. Note: keyed on the ANTECEDENT, never on a
  // fixed list of topography labels.
  const antecedent = String(behavior?.antecedent || '')
  if (resolved === 'Automatic Reinforcement' && !AUTOMATIC_ANTECEDENT.test(antecedent) && SOCIAL_ANTECEDENT.test(antecedent)) {
    return { resolved: 'unknown', matchedPattern, segment: segment || '', conflict: { derived: 'Automatic Reinforcement', antecedent } }
  }

  return { resolved, matchedPattern, segment: segment || '', conflict: null }
}

// Remove client + caregiver names from a text before it is DEBUG-logged (no PHI in logs).
function stripNames(text: string, clientName?: string, caregivers?: string[]): string {
  let t = text || ''
  const names = [clientName || '', ...(Array.isArray(caregivers) ? caregivers : [])]
  for (const raw of names) {
    const n = String(raw || '').trim()
    if (n.length >= 2) t = t.replace(new RegExp(esc(n), 'gi'), '[name]')
  }
  return t
}

// Issue 1: an "incident" is a REPORTABLE event, not a treatment-plan behavior. true only when a
// reportable indicator is present and not negated; false when the note documents only handled
// behaviors; 'unknown' when an indicator is present but no detail exists to fill the required
// "specify incident" child field (so plan-fill/executor skip it rather than emit a broken Yes).
const NEG_INCIDENT = /\b(no|without|denied|denies|free of)\s+(\w+\s+){0,3}(injur|incident|emergenc|bleeding|property damage|first[-\s]aid|medical attention|elopement)/i
function inferIncidents(note: string, dailyLog: any): ThreeState {
  const text = note || ''
  const hasIndicator = containsAny(text, VOCAB.incidentIndicators)
  if (hasIndicator && !NEG_INCIDENT.test(text)) {
    const detail = String(dailyLog?.incidentDetail || '').trim()
    return detail ? true : 'unknown'
  }
  // No reportable indicator (or only a negated one): a documented, handled behavior is NOT an
  // incident. A behavior in Behavior Reduction must NEVER by itself set incidents = true.
  return false
}

// Rule 2: was an antecedent-based procedure used for this behavior? Classify the behavior's
// intervention set against the shared vocabulary. Antecedent present -> true; only
// consequence procedures -> false; empty or unclassifiable -> 'unknown'.
function inferAntecedentInterventionUsed(behavior: any): ThreeState {
  const set = [
    behavior?.antecedentIntervention || '', behavior?.interventions || '',
    behavior?.consequenceIntervention || '',
  ].join(' ').trim()
  if (!set) return 'unknown'
  if (containsAny(set, VOCAB.antecedentProcedures)) return true
  if (containsAny(set, VOCAB.consequenceProcedures)) return false
  return 'unknown'
}

// Change 2b: the ACTUAL before-behavior clause to fill into the conditional "Antecedent
// Interventions" field. Returns the grounded text (the note's own description of what was done
// before the behavior). Never a generic phrase: if nothing traceable exists, returns '' and the
// pair is left for review. Only meaningful when hadAntecedentIntervention === true.
function deriveAntecedentInterventionText(behavior: any): string {
  const ai = String(behavior?.antecedentIntervention || '').trim()
  const iv = String(behavior?.interventions || '').trim()
  // Prefer the dedicated before-behavior field when it names a recognized antecedent procedure.
  if (ai && containsAny(ai, VOCAB.antecedentProcedures)) return ai
  // Otherwise the note's own before-behavior clause (from the LLM's antecedentIntervention field),
  // which is specific to this note — NOT a generic fallback.
  if (ai) return ai
  // Last resort: the intervention clause, but only if it actually names an antecedent procedure.
  if (iv && containsAny(iv, VOCAB.antecedentProcedures)) return iv
  return ''
}

// The text segment that describes a goal's teaching (used by both prompt inferences).
function goalText(skill: any): string {
  return [
    skill?.teachingProcedure || '', skill?.promptDetail || '', skill?.activity || '',
    skill?.name || '',
  ].join(' ').trim()
}

// Rule 2: were prompts used for this goal? Prompt indicator present -> true; an independence
// indicator with no prompt indicator -> false; neither present -> 'unknown'.
function inferPromptsUsed(skill: any): ThreeState {
  const text = goalText(skill)
  const hasPrompt = containsAny(text, VOCAB.promptIndicators)
  const hasIndependence = containsAny(text, VOCAB.independenceIndicators)
  if (hasPrompt) return true
  if (hasIndependence) return false
  return 'unknown'
}

// Issue 1c: the canonical ABA prompt hierarchy. Ordered most-specific-first so the specific
// phrase wins (e.g. "partial physical" is checked before generic "physical guidance").
// Qualifiers ("minimal", "with", "using") don't block a match — we test for the indicator
// substring, not an exact phrase, so "minimal verbal prompting" -> "Verbal".
const PROMPT_TYPE_RULES: { canonical: string; re: RegExp }[] = [
  { canonical: 'Verbal', re: /verbal|using words/i },
  { canonical: 'Gestural', re: /gestural|pointing/i },
  { canonical: 'Model', re: /model(?:ing|ling|ed|led)?|demonstrat/i },
  { canonical: 'Proximity', re: /proximity/i },
  { canonical: 'Partial Physical', re: /partial\s+physical/i },
  { canonical: 'Full Physical', re: /hand[-\s]?over[-\s]?hand|full physical/i },
  { canonical: 'Visual', re: /visual(?:\s+(?:support|supports|schedule|prompt|cue))?|picture|\bcards?\b/i },
]

// Issue 1c: map the goal's prompt indicators to canonical prompt-hierarchy names. Returns a
// deduped list in canonical order. Empty when no prompt type can be identified.
function derivePromptTypes(skill: any): string[] {
  const text = goalText(skill)
  if (!text) return []
  const found = new Set<string>()
  for (const rule of PROMPT_TYPE_RULES) {
    if (rule.re.test(text)) found.add(rule.canonical)
  }
  // Generic "physical guidance" -> Full Physical, but NOT when part of "partial physical guidance".
  const cleaned = text.replace(/partial\s+physical\s+guidance/gi, ' ')
  if (/physical guidance/i.test(cleaned)) found.add('Full Physical')
  return PROMPT_TYPE_RULES.map((r) => r.canonical).filter((c) => found.has(c))
}

// Change 1: environmentalChanges — a COMPLETE note that mentions no environmental change is
// asserting that none occurred (that is how a BCBA reads it), so the DEFAULT is false. 'unknown'
// is reserved for a truncated / clearly incomplete note where we genuinely cannot tell.
const ENV_CHANGE_POSITIVE = new RegExp([
  'environmental\\s+chang',
  'change(s)?\\s+(in|to)\\s+(the\\s+)?(environment|setting|routine|schedule|classroom|home|room)',
  'new\\s+(setting|room|classroom|environment|location|people|person|staff|teacher|aide|caregiver|visitor)',
  '(room|setting|location|classroom)\\s+change',
  'changed\\s+(rooms?|settings?|locations?|classrooms?)',
  'different\\s+(room|setting|location|environment|classroom)',
  '(unusual|loud|excessive|background)\\s+nois',
  'construction',
  'visitor',
  'unfamiliar\\s+(person|people|adult|adults|staff|face|setting)',
  'schedule\\s+(chang|disrupt)',
  'disrupt\\w*\\s+(to\\s+)?(the\\s+)?(routine|schedule|session|environment|transition)',
].join('|'), 'i')
function inferEnvironmentalChanges(note: string): ThreeState {
  const text = (note || '').trim()
  // Truncated / clearly incomplete note -> we can't assert either way.
  if (text.length < 40) return 'unknown'
  // The note explicitly describes an environmental change.
  if (ENV_CHANGE_POSITIVE.test(text)) return true
  // A complete note that describes the session and mentions no such change asserts none occurred.
  return false
}

export async function POST(req: Request) {
  // Bearer-token auth (extension). getExtensionAuth hashes the token and looks it up by
  // token_hash — the extension_tokens table stores a sha256 hash, not the raw token.
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Instantiate the Azure OpenAI client per-request (not at module level) so a missing
  // AZURE_OPENAI_API_KEY at build time can't throw during route collection.
  const client = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
    defaultQuery: { 'api-version': '2025-01-01-preview' },
    defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY || '' },
  })

  const { note, behaviors, skills, caregivers, clientName } = await req.json()
  if (!note) return NextResponse.json({ error: 'Missing note' }, { status: 400 })

  const prompt = `You are a clinical ABA documentation specialist.
Extract structured clinical facts from this session note.
Return ONLY valid JSON — no markdown, no explanation.

SESSION NOTE:
${note}

CLIENT: ${clientName || 'the client'}
BEHAVIORS IN TREATMENT PLAN: ${behaviors?.join(', ')}
SKILLS IN TREATMENT PLAN: ${skills?.join(', ')}
CAREGIVERS: ${caregivers?.join(', ')}

CRITICAL — presentationStart vs presentationEnd:
- presentationStart = how the client presented at the VERY BEGINNING of the session (first paragraph, arrival, initial behaviors)
- presentationEnd = how the client presented at the CLOSE of the session (last paragraph, 'By the close of the session...')
- These MUST be different values extracted from different parts of the note
- 'By the close of the session' or 'By the end of the session' always maps to presentationEnd, never to presentationStart
- The opening sentence/paragraph always maps to presentationStart

CRITICAL — For evidencedBy: write ONLY the topography (physical description of HOW the behavior appeared). Never write WHAT triggered it or WHEN it occurred. The antecedent field handles context.

CRITICAL — For behavior function: function must ALWAYS be one of exactly: Attention, Escape, Tangible, Automatic Reinforcement. If the note says 'attention-maintained' use 'Attention'. If 'escape-maintained' use 'Escape'. If 'tangible-motivated' use 'Tangible'. If 'automatic' or 'self-stimulatory' or 'sensory' use 'Automatic Reinforcement'. If you cannot determine the function from the note, use 'Automatic Reinforcement' as the default. A function field must NEVER be empty, null, or missing.

Return this exact JSON structure:
{
  "dailyLog": {
    "environmentChanges": "Yes or No",
    "environmentChangesDetail": "description if Yes, empty if No",
    "whoWasPresent": ["name1", "name2"],
    "presentationStart": "how client presented at start",
    "evidencedByStart": "what evidenced the start presentation",
    "presentationEnd": "how client presented at end",
    "evidencedByEnd": "what evidenced the end presentation",
    "participation": "how client participated",
    "incidents": "Yes or No",
    "incidentDetail": "description if Yes, empty if No",
    "medicalConcerns": "Yes or No",
    "medicalConcernDetail": "description if Yes, empty if No",
    "relevantInformation": ""
  },
  "behaviors": [
    {
      "name": "exact behavior name from treatment plan",
      "topography": "what the behavior looked like",
      "evidencedBy": "TOPOGRAPHY ONLY — the specific physical form of the behavior (what it looked like, not when or why it occurred). Examples: 'Repetitive finger tapping on table and rocking in seat', 'Dropping to floor and emitting high-pitched vocalizations', 'Reaching for materials without waiting for instruction'. Do NOT describe when it happened or what preceded it.",
      "function": "Attention or Escape or Tangible or Automatic Reinforcement",
      "antecedent": "what triggered the behavior",
      "hadAntecedentIntervention": true or false,
      "antecedentIntervention": "strategy used before behavior if any",
      "consequenceIntervention": "what RBT did after behavior",
      "interventions": "specific intervention names",
      "mainFocus": "Reduce the frequency or Reduce the duration or Reduce the intensity",
      "result": "what happened after intervention",
      "hasSTO": false
    }
  ],
  "skills": [
    {
      "name": "exact skill name from treatment plan",
      "activity": "activity used to practice",
      "teachingProcedure": "DTT or FCT or Modeling or Modeling and gestural prompts or Modeling and visual supports or Activity schedules",
      "promptsUsed": true or false,
      "promptDetail": "type of prompts if used",
      "reinforcers": "what was used as reinforcement",
      "schedule": "Continuous Reinforcement or Fixed Ratio (FR) Schedule or Variable Ratio (VR) Schedule or other",
      "medicalNecessity": "clinical justification sentence"
    }
  ]
}`

  // Same OpenAI completion pattern as fill-aba-matrix/route.ts. max_tokens is raised to 4000
  // because the ClinicalFacts payload (behaviors[] + skills[] with ~12 fields each) is larger
  // than the fill-aba-matrix answers — too low a cap truncates the JSON and breaks JSON.parse.
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 4000,
  })

  const text = response.choices[0]?.message?.content || '{}'
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const facts = JSON.parse(clean)

    // ── Deterministic post-processing (Rules 1 & 2) ──────────────────────────
    // Override the LLM's guesses with tolerant, note-grounded derivations. Fields that
    // cannot be determined become 'unknown' so the executor skips them (never a false "No").
    if (Array.isArray(facts.behaviors)) {
      // Attribute each sentence of the note to a behavior first, so the function is derived from
      // that behavior's OWN prose (where "consistent with X-maintained" actually lives).
      const segments = segmentNoteByBehavior(note, facts.behaviors)
      for (let i = 0; i < facts.behaviors.length; i++) {
        const b = facts.behaviors[i]
        const fn = deriveBehaviorFunction(segments[i], b)
        b.function = fn.resolved
        // Clinical sanity conflict (automatic derived but antecedent is social): carry it so the
        // pair is flagged for review — never a silent blank — with the derived function + antecedent.
        if (fn.conflict) {
          b.functionConflict = {
            reason: 'FUNCTION_ANTECEDENT_CONFLICT',
            derived: fn.conflict.derived,
            antecedent: fn.conflict.antecedent,
          }
        }
        b.hadAntecedentIntervention = inferAntecedentInterventionUsed(b)
        // Change 2b: extract the grounded before-behavior clause so plan-fill can fill the
        // conditional "Antecedent Interventions" child (only when an antecedent was used).
        b.antecedentInterventionText = b.hadAntecedentIntervention === true
          ? deriveAntecedentInterventionText(b) : ''
        // Issue 2: prove the derivation ran and show EXACTLY what it matched against, plus the
        // antecedent and any sanity-rule conflict (so segmentation misattribution is traceable).
        // All text is PHI-stripped (client + caregiver names removed) and capped.
        if (DEBUG) {
          console.log('[extract-facts] function derivation —', {
            behaviorIndex: i,
            matchedPattern: fn.matchedPattern,
            resolvedFunction: fn.resolved,
            conflict: fn.conflict ? `FUNCTION_ANTECEDENT_CONFLICT (patterns said ${fn.conflict.derived})` : null,
            antecedent: stripNames(String(b.antecedent || ''), clientName, caregivers).slice(0, 140),
            segment: stripNames(fn.segment, clientName, caregivers).slice(0, 200),
          })
        }
      }
    }
    if (Array.isArray(facts.skills)) {
      for (const s of facts.skills) {
        s.promptsUsed = inferPromptsUsed(s)
        // Issue 1c: the "which prompts" child needs a value. Populate it from the same text so
        // plan-fill can fill the conditional field revealed by promptsUsed = Yes.
        s.promptTypes = derivePromptTypes(s)
      }
    }
    if (facts.dailyLog) {
      facts.dailyLog.environmentChanges = inferEnvironmentalChanges(note)
      facts.dailyLog.incidents = inferIncidents(note, facts.dailyLog)
    }

    if (DEBUG) {
      // Counts only — no field values (PHI) in logs.
      const fnUnknown = (facts.behaviors || []).filter((b: any) => b.function === 'unknown').length
      const aiUnknown = (facts.behaviors || []).filter((b: any) => b.hadAntecedentIntervention === 'unknown').length
      const pUnknown = (facts.skills || []).filter((s: any) => s.promptsUsed === 'unknown').length
      const pTypesEmpty = (facts.skills || []).filter((s: any) => s.promptsUsed === true && (!s.promptTypes || s.promptTypes.length === 0)).length
      console.log('[extract-facts] three-state unknowns —',
        'function:', fnUnknown, 'antecedentIntervention:', aiUnknown,
        'prompts:', pUnknown, 'env:', facts.dailyLog?.environmentChanges,
        'incidents:', facts.dailyLog?.incidents,
        '| promptsUsed=true but no promptTypes:', pTypesEmpty)
    }

    return NextResponse.json({ facts })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
  }
}
