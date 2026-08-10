import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { inferFunctionFromAntecedent, segmentNoteByBehavior, deriveBehaviorFunction, constrainFunctionToApproved, matrixFunctionsForBehavior } from '@/lib/functionPatterns'
import { approvedTeachingMethods, deriveTeachingMethod } from '@/lib/teachingMethods'
import { findInterventionViolations } from '@/lib/interventionPolicy'

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

// Behavior-function phrase patterns live in a shared, pure module (single source of truth) with a
// regression test — see lib/functionPatterns.ts for the failure-class doc + the anti-bare-noun rule.
// (Output strings are the canonical labels; plan-fill normalizes 'Tangibles' -> the dropdown option.)

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

// Note→per-behavior function derivation (segmentNoteByBehavior, deriveBehaviorFunction) now lives in
// the shared lib/behaviorFunction module so generation can enforce the same approved-function rule.

// INTERVENTION GATE (autofill safety-net). The note feeding AI Fill can be hand-edited or pasted (the
// output box is an editable textarea), so it may never have passed the generation/refiner intervention
// gate. Mirror that gate here at fill time: an intervention FIELD that asserts a prohibited (RIRD, …) or
// non-approved intervention is scrubbed rather than transcribed into a signed compliance form. Reuses
// lib/interventionPolicy — same catalog + role-awareness, so coverage matches the generation gate.
// Returns the violating canonical names found in a single field string (empty = clean).
function fieldInterventionViolations(text: any, approved: string[], skills: string[]): string[] {
  if (!text || !String(text).trim()) return []
  const v = findInterventionViolations(String(text), approved, skills)
  return [...new Set([...v.prohibited, ...v.unapproved, ...v.skillAsReduction])]
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

  const { note, behaviors, skills, caregivers, clientName, clientId } = await req.json()
  if (!note) return NextResponse.json({ error: 'Missing note' }, { status: 400 })

  // Assessment-approved function set per behavior (clinical_profile.maladaptiveBehaviors[].functions).
  // The extractor must not derive a function the assessment never approved for a behavior — this is the
  // authoritative, always-current source, fetched by clientId (single source of truth, no map on the wire).
  const behaviorFunctionMap = new Map<string, string[]>()
  // Approved reduction interventions + replacement skill programs, read from the SAME profile fetch —
  // they feed the intervention gate below (the autofill safety-net). With no profile captured both stay
  // empty, so only always-prohibited procedures (RIRD, …) are scrubbed and nothing else false-fails.
  let approvedInterventions: string[] = []
  let skillPrograms: string[] = []
  // The function options the client's ABA Matrix dropdown actually offers, captured by the extension at
  // fill time. `current` holds the captured catalog: `functions` is the legacy GLOBAL UNION,
  // `functionsByBehavior` (when present) each behavior's OWN dropdown. Resolve PER BEHAVIOR below
  // (matrixFunctionsForBehavior falls back to the union → no regression for pre-per-behavior captures).
  // Undefined when never captured (the common case) — the constraint then narrows nothing.
  let capturedCatalog: { functions?: string[]; functionsByBehavior?: Record<string, string[]> } | undefined
  if (clientId) {
    try {
      const client = await prisma.clients.findUnique({ where: { id: clientId }, select: { clinical_profile: true } })
      const profile = (client?.clinical_profile as any) || {}
      const current = profile?.observedCatalog?.aba_matrix?.current
      if (current && typeof current === 'object') capturedCatalog = current
      const mal = profile.maladaptiveBehaviors
      if (Array.isArray(mal)) {
        for (const b of mal) {
          const name = String(b?.name || '').trim().toLowerCase()
          const funcs = Array.isArray(b?.functions) ? b.functions : (Array.isArray(b?.function) ? b.function : [])
          if (name && funcs.length) behaviorFunctionMap.set(name, funcs)
        }
      }
      const names = (arr: any): string[] =>
        (Array.isArray(arr) ? arr : []).map((x: any) => (typeof x === 'string' ? x : x?.name)).filter(Boolean)
      approvedInterventions = names(profile.interventions)
      skillPrograms = [...names(profile.replacementBehaviors), ...names(profile.skillAcquisition)]
    } catch { /* best-effort: with no map the constraint simply doesn't fire (unconstrained) */ }
  }
  const approvedFunctionsFor = (behaviorName: string): string[] | undefined => {
    const key = String(behaviorName || '').trim().toLowerCase()
    if (behaviorFunctionMap.has(key)) return behaviorFunctionMap.get(key)
    // Loose fallback: a note behavior label that contains (or is contained by) an approved one.
    for (const [k, v] of behaviorFunctionMap) if (k && (key.includes(k) || k.includes(key))) return v
    return undefined
  }
  // This behavior's OWN captured ABA-Matrix dropdown (per-behavior; falls back to the global union,
  // then undefined for a client with no capture at all — the constraint then narrows nothing).
  const matrixFunctionsFor = (behaviorName: string): string[] | undefined =>
    matrixFunctionsForBehavior(capturedCatalog, behaviorName)

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

CRITICAL — For behavior function: function must be one of exactly: Attention, Escape, Tangible, Automatic Reinforcement. If the note says 'attention-maintained' use 'Attention'. If 'escape-maintained' use 'Escape'. If 'tangible-motivated' use 'Tangible'. If 'sensory-maintained' or 'self-stimulatory' or 'stereotypic' use 'Automatic Reinforcement'. Automatic Reinforcement applies ONLY when there is NO social antecedent (no demand, no denied/withheld item, no attention shift, no directed transition). Do NOT default to 'Automatic Reinforcement' when the function is unclear — the system re-derives the function deterministically from the note, so never pad an undetermined function with 'Automatic Reinforcement'.

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
      "schedule": "the reinforcement schedule the note EXPLICITLY states, as one canonical option — Continuous Reinforcement, Fixed Ratio (FR) Schedule, Variable Ratio (VR) Schedule, or other; EMPTY STRING \"\" if the note does not specify a schedule (do not guess one)",
      "medicalNecessity": "clinical justification sentence"
    }
  ]
}`

  // max_tokens is raised to 4000 because the ClinicalFacts payload (behaviors[] + skills[] with
  // ~12 fields each) is large — too low a cap truncates the JSON and breaks JSON.parse.
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
        let functionReview: any = null
        let inferredFn: string | null = null
        if (fn.resolved === 'unknown') {
          // Fallback: the note always states the function, so an 'unknown' means extraction missed
          // it. Infer from the antecedent (clinical evidence in the same note) — never a default. A
          // successfully-inferred function is marked for review ("inferred — verify"); the executor
          // still only fills it if the client's dropdown offers it.
          inferredFn = inferFunctionFromAntecedent(b.antecedent)
          if (inferredFn) {
            b.function = inferredFn
            functionReview = { reason: 'INFERRED_FROM_ANTECEDENT', intended: inferredFn, antecedent: String(b.antecedent || '') }
          } else if (fn.conflict) {
            // Automatic derived but antecedent is social AND the antecedent matched no function:
            // stay 'unknown' and flag the conflict (never a silent blank).
            functionReview = { reason: 'FUNCTION_ANTECEDENT_CONFLICT', intended: fn.conflict.derived, antecedent: fn.conflict.antecedent }
          }
        }
        // The function the NOTE stated for THIS behavior (prose-derived, else antecedent-inferred),
        // captured BEFORE the constraint below may overwrite it to 'unknown' (config gap). The executor's
        // live-net prefers this when the real dropdown offers it, so the filled function matches the note
        // prose ("consistent with escape-maintained" -> Escape), never a different approved function that
        // would make form and prose contradict. Omitted when the note stated nothing usable.
        b.notedFunction = b.function && b.function !== 'unknown' ? b.function : undefined
        // Approved-function CONSTRAINT: the assessment defines the closed set of functions valid for
        // this behavior. If the final function is not approved, prefer an approved one the antecedent
        // supports; if none fits, leave blank + review — never write a function the assessment did not
        // approve for this behavior (e.g. Throwing Objects must not be filled as Automatic when the
        // assessment approved only Escape/Tangible/Attention).
        const approvedForBehavior = approvedFunctionsFor(b.name)
        if (approvedForBehavior && approvedForBehavior.length) {
          // Carry the approved set onto the fact so plan-fill can attach it to the BehaviorFunction
          // action — the executor's live-net re-intersects it against the REAL dropdown at fill time.
          b.approvedFunctions = approvedForBehavior
          // Constrain to the EFFECTIVE set (approved ∩ THIS behavior's ABA-Matrix dropdown). Per-behavior
          // (matrixFunctionsFor); undefined when no catalog was captured -> narrows nothing (no regression).
          const behaviorMatrix = matrixFunctionsFor(b.name)
          const c = constrainFunctionToApproved(b.function, approvedForBehavior, b.antecedent, behaviorMatrix)
          if (c.status === 'corrected' || c.status === 'defaulted') {
            // Filled with an approved+recordable function (antecedent-chosen, or the sole/primary member).
            // Never blank a mandatory field; flag so the RBT verifies.
            b.function = c.fn
            functionReview = { reason: 'FUNCTION_NOT_APPROVED', intended: c.fn, from: c.from, antecedent: String(b.antecedent || ''), approved: approvedForBehavior }
          } else if (c.status === 'not_in_matrix') {
            // Config gap: the assessment approves function(s) THIS behavior's ABA Matrix dropdown cannot
            // record. Blank + a distinct review to the BCBA/admin (add the option), never silent. The
            // executor's live-net gets the final say at fill time against the real dropdown.
            b.function = 'unknown'
            functionReview = { reason: 'FUNCTION_NOT_IN_MATRIX', intended: null, unrecordable: c.unrecordable, antecedent: String(b.antecedent || ''), approved: approvedForBehavior, matrixFunctions: behaviorMatrix }
          }
        }
        if (functionReview) b.functionReview = functionReview
        // Intervention gate: scrub any per-behavior intervention field naming a prohibited/non-approved
        // intervention BEFORE the antecedent-intervention derivations below read these fields, so an
        // out-of-plan procedure from ungated note text cannot reach the form (blank + flag for the RBT).
        const removedIv = new Set<string>()
        for (const f of ['interventions', 'consequenceIntervention', 'antecedentIntervention'] as const) {
          const bad = fieldInterventionViolations(b[f], approvedInterventions, skillPrograms)
          if (bad.length) { b[f] = ''; bad.forEach((x) => removedIv.add(x)) }
        }
        if (removedIv.size) {
          b.interventionReview = { reason: 'INTERVENTION_NOT_APPROVED', removed: [...removedIv], approved: approvedInterventions }
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
            patternResolved: fn.resolved,
            finalFunction: b.function,
            inferredFromAntecedent: inferredFn || null,
            reviewReason: functionReview ? functionReview.reason : null,
            antecedent: stripNames(String(b.antecedent || ''), clientName, caregivers).slice(0, 140),
            segment: stripNames(fn.segment, clientName, caregivers).slice(0, 200),
          })
        }
      }
    }
    if (Array.isArray(facts.skills)) {
      // Commit 4, Part 2: the teaching-procedure field is filled by COPYING the approved method the note
      // stated for each skill — not the old fixed-enum LLM guess. Part 1 constrains the note to approved
      // methods, so whatever it named is approved; here we also constrain, so even a hand-written note
      // yields only an approved method. Segment the note per skill so the method is read from that skill's
      // own prose. The approved method SET comes from the LIVE profile (interventions ∩ method vocab).
      const approvedMethodSet = [...approvedTeachingMethods(approvedInterventions)]
      const skillSegments = segmentNoteByBehavior(note, facts.skills)
      for (let i = 0; i < facts.skills.length; i++) {
        const s = facts.skills[i]
        s.promptsUsed = inferPromptsUsed(s)
        // Issue 1c: the "which prompts" child needs a value. Populate it from the same text so
        // plan-fill can fill the conditional field revealed by promptsUsed = Yes.
        s.promptTypes = derivePromptTypes(s)

        const noteMethod = deriveTeachingMethod(skillSegments[i], approvedInterventions)
        if (noteMethod) {
          s.teachingProcedure = noteMethod
        } else if (approvedMethodSet.length) {
          // The prose named no method for this skill, but the client HAS approved methods: fill the
          // primary approved method (from the assessment, NOT a guessed default), flagged to verify.
          s.teachingProcedure = approvedMethodSet[0]
          s.teachingProcedureReview = { reason: 'METHOD_DEFAULTED', intended: approvedMethodSet[0], approved: approvedMethodSet }
        } else {
          // CONFIG GAP: the assessment approves NO teaching method for this client. Never invent a
          // default (that is the exact bug we removed). Leave blank + a loud BCBA finding.
          s.teachingProcedure = ''
          s.teachingProcedureReview = { reason: 'NO_APPROVED_METHOD', approved: [] }
        }
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
