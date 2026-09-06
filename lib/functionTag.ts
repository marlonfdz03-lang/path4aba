// FUNCTION TAG — MEASUREMENT ONLY. A post-gate, non-streamed model call reads the FINAL note prose and reports
// which function each selected behavior's ABC STATES; this module turns that raw reply into an admin-only
// gate_findings record comparing the READ function against the ASSIGNED function (from generationContext).
//
// IT NEVER REPAIRS, NEVER FLAGS TO THE RBT, NEVER BLOCKS. WHY: the source is the SAME model reading its OWN
// prose — a monitoring signal, not proof. On ambiguous prose its read can reflect the same bias that wrote the
// note, so it is NOT an independent auditor. Anyone who later wants to turn this into a gate MUST read this
// first, and corroborate against a deterministic parser (FUNCTION_PATTERNS) before acting on it.
//
// Pure + import-free of prisma/openai so it is unit-testable on bare node. The model call + persistence live in
// the caller (lib/generateSmartNote), fire-and-forget and off the RBT's path.
import { functionToCanonical } from './functionPatterns.ts'
import type { GateFinding } from './gateFindings.ts'

// The prompt for the post-gate read. Kept next to the parser so both are reviewed together. The NOTE passed in
// MUST already be name-scrubbed by the caller (this reply prompt carries PHI like any other generation prompt).
export function buildFunctionReadPrompt(scrubbedNote: string, behaviorNames: string[]): { system: string; user: string } {
  const system =
    'You are auditing a finished ABA session note. For EACH behavior name given, report the single behavioral ' +
    'function the note\'s ABC for that behavior STATES — one of: escape, attention, tangible, automatic — or ' +
    '"none" if its ABC states no function. Report ONLY what the text says; do not infer. Return ONLY a JSON ' +
    'object mapping each behavior name to its function. No prose, no code fences.'
  const user = `NOTE:\n${scrubbedNote}\n\nBEHAVIORS:\n${behaviorNames.join('\n')}`
  return { system, user }
}

// Extract the first {...} object from a model reply and parse it; null on anything unparseable. Never throws.
export function parseFunctionReadJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  const s = String(raw)
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const o = JSON.parse(s.slice(a, b + 1))
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch { return null }
}

// PURE. Build the admin-only finding(s) from the assigned functions (generationContext.perBehavior) and the raw
// model reply. Never throws.
//   • no behavior has an assigned function → [] (nothing measurable, record nothing)
//   • reply absent/unparseable → ONE function_tag_unavailable finding (drift not measured this note)
//   • otherwise → ONE function_tag finding whose context carries BOTH values per behavior (assigned + read) so
//     the record is SELF-CONTAINED — a future reader never has to join back to generation_context.
export function functionTagFindings(
  perBehavior: Record<string, { function?: string | null }> | null | undefined,
  rawModelReply: string | null | undefined,
): GateFinding[] {
  const entries = Object.entries(perBehavior || {})
    .map(([name, a]) => ({ name, assigned: functionToCanonical(a?.function) }))
    .filter((e): e is { name: string; assigned: string } => !!e.assigned)
  if (!entries.length) return []

  const parsed = parseFunctionReadJson(rawModelReply)
  if (!parsed) {
    return [{
      gate: 'function_tag_unavailable', severity: 'info',
      detail: 'Post-gate function read returned no parseable JSON; per-behavior drift not measured for this note.',
      context: { behaviorCount: entries.length },
    }]
  }
  // Case-insensitive behavior-name lookup (the model may vary casing).
  const lower: Record<string, unknown> = {}
  for (const k of Object.keys(parsed)) lower[k.toLowerCase()] = parsed[k]

  const rows = entries.map((e) => {
    const rawVal = parsed[e.name] ?? lower[e.name.toLowerCase()]
    const read = functionToCanonical(typeof rawVal === 'string' ? rawVal : null)
    return { behavior: e.name, assigned: e.assigned, read, agree: read === e.assigned }
  })
  const disagreements = rows.filter((r) => !r.agree).length
  return [{
    gate: 'function_tag', severity: 'info',
    detail: `Function read vs assigned: ${rows.length - disagreements}/${rows.length} agree, ${disagreements} disagree (monitoring only — same-model self-read, not proof).`,
    context: { rows, disagreements },
  }]
}
