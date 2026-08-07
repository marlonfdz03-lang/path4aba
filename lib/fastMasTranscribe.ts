// lib/fastMasTranscribe.ts — FAST/MAS step 3: transcribe geometry-LOCATED cells + validate against geometry.
//
// DIVISION OF LABOR (keeps LLM judgment minimal — the generalization principle):
//   • GEOMETRY (deterministic, step 2) extracts the clinical data: behavior COUNT, FUNCTIONS (vocabulary
//     dominance), DIAGNOSIS codes (confirmed-table), MASTERED-section items. No LLM touches these.
//   • The LLM ONLY tidies the located NAME cells (behavior names / skill names that PDF fragmentation split,
//     e.g. "SIB (Self- Injury" → "Self-Injurious Behavior (SIB)"). It transcribes LOCATED cells — never free
//     prose — and may not add or drop an entry.
//   • VALIDATION (deterministic firewall) rejects any transcription that violates the geometry.
//
// STRIP-BEFORE-LLM: every string the LLM sees is redacted with the record's known names FIRST (step-2 fix).
// No raw identifier reaches transcription. Geometry-unlocatable data (Felix narrative functions) stays [].

import OpenAI from 'openai'
import type { Row } from './pdfGeometry.ts'
import { readBehaviorFunctions, readMasteredSkills, readConfirmedDiagnosis, redactText } from './pdfGeometry.ts'

export const FUNCTION_VOCAB = ['escape', 'attention', 'tangible', 'automatic', 'sensory'] as const

export interface LocatedInput {
  behaviors: { rawName: string; functions: string[] }[] // rawName is REDACTED located name text
  masteredItems: string[]                                 // REDACTED located MASTERED-section text
  diagnosisCodes: string[]                                // geometry (confirmed-table), deterministic
  geometricBehaviorCount: number
}

// LOCATE (geometry) + STRIP (redact). Produces exactly what the LLM will see — located cells, redacted.
export function buildLocatedInput(rows: Row[], knownNames: string[]): LocatedInput {
  const bf = readBehaviorFunctions(rows)
  const ms = readMasteredSkills(rows)
  const dx = readConfirmedDiagnosis(rows)
  return {
    behaviors: bf.map((b) => ({ rawName: redactText(b.behavior, knownNames), functions: b.functions })),
    masteredItems: [...new Set(ms.flatMap((h) => h.items).map((t) => redactText(t, knownNames)))],
    diagnosisCodes: dx?.codes ?? [],
    geometricBehaviorCount: bf.length,
  }
}

export interface Transcribed { behaviors: { name: string; functions: string[] }[]; masteredSkills: string[] }

// TRANSCRIBE — LLM tidies located name cells ONLY. Constrained: no invention, no prose, exact counts.
export async function transcribeLocated(input: LocatedInput, openai: OpenAI): Promise<Transcribed> {
  const system = `You transcribe CELLS already located in an ABA assessment table. You do NOT read prose, you do
NOT infer, you do NOT use outside knowledge. You only clean up the exact cells given: fix words that PDF
extraction split (e.g. "Self- Injury" -> "Self-Injurious"), and return clean names. RULES:
- Return EXACTLY one behavior per input behavior, in the SAME ORDER. Never add or remove a behavior.
- "functions" = copy the given functions verbatim (they are already validated); do not change or add.
- Never invent a name that is not represented in the given cell text. If a cell is only a header fragment,
  return it as-is.
- masteredSkills: clean each located item into a skill name; never add or drop an item.
Return ONLY JSON: {"behaviors":[{"name":"...","functions":[...]}],"masteredSkills":["..."]}`
  const user = `Behavior name cells (with their located functions):\n${JSON.stringify(input.behaviors, null, 2)}\n\nMASTERED-section located items:\n${JSON.stringify(input.masteredItems)}`
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o', temperature: 0, seed: 42, max_tokens: 2000,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  })
  const raw = (resp.choices[0].message.content || '{}').replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(raw)
  return { behaviors: parsed.behaviors ?? [], masteredSkills: parsed.masteredSkills ?? [] }
}

// VALIDATE — deterministic firewall. Returns the violations (empty = passes).
export function validate(t: Transcribed, input: LocatedInput): string[] {
  const v: string[] = []
  // Gate 1 — behavior count = geometric row count (kills the wobble; no add/drop by the LLM)
  if (t.behaviors.length !== input.geometricBehaviorCount)
    v.push(`behavior count ${t.behaviors.length} != geometric ${input.geometricBehaviorCount}`)
  // Gate 2 — functions ∈ vocabulary (reject any invented/non-vocabulary function)
  for (const b of t.behaviors)
    for (const f of b.functions)
      if (!FUNCTION_VOCAB.includes(f as any)) v.push(`invented function "${f}" on "${b.name}"`)
  // Gate 4 — mastered skills = located set (neither invent nor drop): counts must match
  if (t.masteredSkills.length !== input.masteredItems.length && input.masteredItems.length)
    v.push(`mastered count ${t.masteredSkills.length} != located ${input.masteredItems.length}`)
  // Gate 3 — diagnosis: no Z-code / firewall (codes are geometry-sourced; guard the invariant)
  for (const c of input.diagnosisCodes) if (/^Z/i.test(c)) v.push(`Z-code in diagnosis: ${c}`)
  return v
}
