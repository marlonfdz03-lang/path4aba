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
    'behavior momentum', 'high-probability request', 'high-p request', 'high-p sequence',
    'high probability request', 'ncr', 'non-contingent reinforcement', 'noncontingent reinforcement',
    'premack', 'environmental modification', 'priming', 'visual schedule', 'visual support',
    'visual supports', 'antecedent intervention', 'antecedent-based', 'antecedent strategy',
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

// Rule 1: derive the function from tolerant patterns run over the behavior's text segment
// (note + the behavior's own extracted fields). If more than one pattern matches, take the
// one whose match index is closest to the behavior's topography. If none match, 'unknown'.
function deriveBehaviorFunction(note: string, behavior: any): string {
  const hay = [
    note || '',
    behavior?.topography || '', behavior?.evidencedBy || '', behavior?.antecedent || '',
    behavior?.interventions || '', behavior?.result || '',
  ].join('\n')

  const matches: { label: string; index: number }[] = []
  for (const { re, label } of FUNCTION_PATTERNS) {
    const m = re.exec(hay)
    if (m) matches.push({ label, index: m.index })
  }
  if (matches.length === 0) return 'unknown'
  if (matches.length === 1) return matches[0].label

  const anchor = anchorIndex(hay, behavior)
  if (anchor >= 0) {
    matches.sort((a, b) => Math.abs(a.index - anchor) - Math.abs(b.index - anchor))
  }
  // Deterministic tiebreak when there's no topography anchor: FUNCTION_PATTERNS order.
  return matches[0].label
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

// Rule 2: were prompts used for this goal? Prompt indicator present -> true; an independence
// indicator with no prompt indicator -> false; neither present -> 'unknown'.
function inferPromptsUsed(skill: any): ThreeState {
  const text = [
    skill?.teachingProcedure || '', skill?.promptDetail || '', skill?.activity || '',
    skill?.name || '',
  ].join(' ').trim()
  const hasPrompt = containsAny(text, VOCAB.promptIndicators)
  const hasIndependence = containsAny(text, VOCAB.independenceIndicators)
  if (hasPrompt) return true
  if (hasIndependence) return false
  return 'unknown'
}

// Rule 2: environmental changes are true/false only when the note states it explicitly;
// 'unknown' otherwise (never default to "No").
const ENV_CHANGE_POSITIVE = /\b(significant|notable|environmental)\s+chang|change(s)?\s+(in|to)\s+(the\s+)?(environment|routine|setting|staff|schedule|classroom|home)|new\s+(staff|setting|environment|routine|classroom|teacher)/i
const ENV_CHANGE_NEGATIVE = /\bno\s+(significant|notable|environmental)?\s*chang|\bno\s+changes\b|denied\s+any\s+changes|there\s+were\s+no\s+changes/i
function inferEnvironmentalChanges(note: string, dailyLog: any): ThreeState {
  const text = note || ''
  if (ENV_CHANGE_NEGATIVE.test(text)) return false
  if (ENV_CHANGE_POSITIVE.test(text)) return true
  // Corroborated LLM signal: an explicit "Yes" WITH a described detail counts as explicit.
  const yn = String(dailyLog?.environmentChanges || '').trim().toLowerCase()
  const detail = String(dailyLog?.environmentChangesDetail || '').trim()
  if (yn === 'yes' && detail) return true
  return 'unknown'
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
      for (const b of facts.behaviors) {
        b.function = deriveBehaviorFunction(note, b)
        b.hadAntecedentIntervention = inferAntecedentInterventionUsed(b)
      }
    }
    if (Array.isArray(facts.skills)) {
      for (const s of facts.skills) {
        s.promptsUsed = inferPromptsUsed(s)
      }
    }
    if (facts.dailyLog) {
      facts.dailyLog.environmentChanges = inferEnvironmentalChanges(note, facts.dailyLog)
    }

    if (DEBUG) {
      // Counts only — no field values (PHI) in logs.
      const fnUnknown = (facts.behaviors || []).filter((b: any) => b.function === 'unknown').length
      const aiUnknown = (facts.behaviors || []).filter((b: any) => b.hadAntecedentIntervention === 'unknown').length
      const pUnknown = (facts.skills || []).filter((s: any) => s.promptsUsed === 'unknown').length
      console.log('[extract-facts] three-state unknowns —',
        'function:', fnUnknown, 'antecedentIntervention:', aiUnknown,
        'prompts:', pUnknown, 'env:', facts.dailyLog?.environmentChanges)
    }

    return NextResponse.json({ facts })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
  }
}
