// Terms the host EHR (ABA Matrix) rejects in the narrative section — a payer-compliance rule on
// THEIR side, not ours. Example: "sensory" implies sensory-integration therapy, which is not ABA
// and not billable under 97153, so ABA Matrix blocks it on submit ("The text < sensory > is not
// allowed in the narrative section"). We strip these from generated narrative BEFORE returning the
// note so the RBT never hits the rejection.
//
// Build for the CLASS, not the one word:
//   - This list is configurable and seeded with the known term.
//   - The extension LEARNS more by capturing "text < X > is not allowed" messages from the host
//     (the same passive-capture pattern as the program catalog) and storing them per client; those
//     learned terms are merged in at generation time via `extraTerms`.
//   - Where we have an approved substitute we swap it in; where we DON'T, we FLAG the term to the
//     RBT rather than silently deleting clinical content.

export interface BlockedTerm { term: string; substitute: string | null }

// Seed. Acceptable substitutes for a "sensory play activity": tactile / manipulative / texture-based
// / hands-on. The automated map uses one canonical substitute; the note still reads naturally.
//
// "academic" is the SECOND confirmed ABA-Matrix rejection ("The text < academic > is not allowed …"):
// the payer reads it as academic tutoring/education, which is not ABA and not billable under 97153 — the
// same logic that blocks "sensory". It MUST carry a substitute (not just a flag) so the filtered note the
// extension autofills never contains it. "structured" reads clinically across the leaked contexts
// ("academic demand"→"structured demand", "academic task"→"structured task"). The PRIMARY fix is upstream
// (masterPrompt no longer templates "academic settings"/"academic … demands"; curatedActivities renamed
// "academic worksheet activity"→"worksheet activity") — this is the backstop for any stray LLM leak.
export const BLOCKED_NARRATIVE_TERMS: BlockedTerm[] = [
  { term: 'sensory', substitute: 'tactile' },
  { term: 'academic', substitute: 'structured' },
  // "calm"/"calmed" are MENTALISTIC (an unobservable internal state) AND rejected by the EHR. Substitute with
  // an OBSERVABLE word so the note saves; the masterPrompt category ban is the primary fix. NOTE: these are
  // protected inside AUTHORIZED plan names (e.g. a "Calm-Down Routine" program) — see filterBlockedNarrative.
  // CALM / REGULATION FAMILY — substitute with a NEUTRAL observable word (does not fabricate an action).
  { term: 'calm', substitute: 'quiet' },
  { term: 'calmed', substitute: 'quieted' },
  { term: 'calming', substitute: 'quieting' },
  // \b{term}\b is exact-word, so each inflection needs its own entry: "calm" does not cover "calmly"/
  // "calmness" (both reached live notes). The adverb keeps a neutral swap ("sat calmly" -> "sat quietly");
  // the noun names an unobservable state with no clean neutral swap, so it is flag-only like the group below.
  { term: 'calmly', substitute: 'quietly' },
  { term: 'calmness', substitute: null },
  { term: 'relaxed', substitute: 'quiet' },
  { term: 'regulated', substitute: 'quiet' },
  { term: 'composed', substitute: 'quiet' },
  { term: 'soothed', substitute: 'quieted' },
  // Emotional-state / intent words have NO neutral single-word swap — substituting them would INVENT an
  // unobserved action ("frustrated" → "pushed materials away" is fabrication). Those are flag-only here
  // (surfaced pre-fill) and prevented at the source by the masterPrompt category ban + detected by
  // redFlagPhrases. The full category list + observable rewrites live in the prompt.
  { term: 'dysregulated', substitute: null },
  { term: 'escalated', substitute: null },
  { term: 'de-escalated', substitute: null },
  { term: 'frustrated', substitute: null },
  // The noun of the same mentalistic construct — an unobservable internal state, so flag-only like 'frustrated'.
  { term: 'frustration', substitute: null },
  { term: 'upset', substitute: null },
  { term: 'overwhelmed', substitute: null },
  { term: 'distressed', substitute: null },
]

export interface BlockedFilterResult {
  text: string
  substituted: string[] // blocked terms that were replaced with a substitute
  flagged: string[]      // blocked terms present with NO substitute — left in place, flagged to the RBT
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// PLAN-CONTENT PROTECTION: a blocked term may legitimately appear inside an AUTHORIZED name from the treatment
// plan — an intervention/program/reinforcer/behavior name or a topography (e.g. a "Calm-Down Routine" program,
// a "sensory bin" reinforcer). We must NOT rewrite authorized plan content; only the model's own prose. Compute
// the character spans covered by any authorized name, and skip a term match that starts inside one.
type Range = [number, number]
function protectedRanges(text: string, authorizedNames: string[]): Range[] {
  const names = [...new Set((authorizedNames || []).map((n) => String(n || '').trim()).filter((n) => n.length >= 3))]
  if (!names.length) return []
  const alt = names.sort((a, b) => b.length - a.length).map(escapeRe).join('|') // longest-first
  const re = new RegExp(alt, 'gi')
  const ranges: Range[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) { ranges.push([m.index, m.index + m[0].length]); if (m.index === re.lastIndex) re.lastIndex++ }
  return ranges
}
const inRanges = (i: number, ranges: Range[]) => ranges.some(([a, b]) => i >= a && i < b)

// Replace a term as a whole word (case-insensitive), preserving leading-letter case — but NEVER inside an
// authorized name span (those are masked-and-restored by leaving the match untouched).
function replaceTerm(text: string, term: string, substitute: string, ranges: Range[]): { text: string; hit: boolean } {
  let hit = false
  const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'gi')
  const out = text.replace(re, (m: string, offset: number) => {
    if (inRanges(offset, ranges)) return m // inside an authorized plan name → leave untouched
    hit = true
    return m[0] === m[0].toUpperCase() ? substitute.charAt(0).toUpperCase() + substitute.slice(1) : substitute
  })
  return { text: out, hit }
}

// Strip blocked terms from narrative text. Substitutes where possible; flags (never deletes) where not. Terms
// appearing INSIDE an authorized plan name (authorizedNames) are protected — never substituted or flagged.
export function filterBlockedNarrative(text: string, extraTerms: BlockedTerm[] = [], authorizedNames: string[] = []): BlockedFilterResult {
  let out = text || ''
  const substituted: string[] = []
  const flagged: string[] = []
  const seen = new Set<string>()
  for (const { term, substitute } of [...BLOCKED_NARRATIVE_TERMS, ...extraTerms]) {
    const key = String(term || '').toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const ranges = protectedRanges(out, authorizedNames) // recompute on the current text (authorized names are never rewritten)
    if (substitute) {
      const r = replaceTerm(out, term, substitute, ranges)
      out = r.text
      if (r.hit) substituted.push(term)
    } else {
      // no substitute — flag only if the term appears OUTSIDE any authorized name (don't flag protected content)
      const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'gi')
      let m: RegExpExecArray | null, present = false
      while ((m = re.exec(out)) !== null) { if (!inRanges(m.index, ranges)) { present = true; break } if (m.index === re.lastIndex) re.lastIndex++ }
      if (present) flagged.push(term)
    }
  }
  return { text: out, substituted, flagged }
}

// Parse a host validation message like: "The text < sensory > is not allowed in the narrative
// section" -> "sensory". Used by the extension's passive capture to learn new blocked terms.
export function parseBlockedTermMessage(message: string): string | null {
  const m = /text\s*<\s*([^>]+?)\s*>\s*is not allowed/i.exec(String(message || ''))
  return m ? m[1].trim() : null
}
