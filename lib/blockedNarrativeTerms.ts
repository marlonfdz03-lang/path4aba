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
]

export interface BlockedFilterResult {
  text: string
  substituted: string[] // blocked terms that were replaced with a substitute
  flagged: string[]      // blocked terms present with NO substitute — left in place, flagged to the RBT
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Replace a term as a whole word (case-insensitive), preserving the leading-letter case of each match.
function replaceTerm(text: string, term: string, substitute: string): { text: string; hit: boolean } {
  let hit = false
  const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'gi')
  const out = text.replace(re, (m) => {
    hit = true
    return m[0] === m[0].toUpperCase() ? substitute.charAt(0).toUpperCase() + substitute.slice(1) : substitute
  })
  return { text: out, hit }
}

// Strip blocked terms from narrative text. Substitutes where possible; flags (never deletes) where not.
export function filterBlockedNarrative(text: string, extraTerms: BlockedTerm[] = []): BlockedFilterResult {
  let out = text || ''
  const substituted: string[] = []
  const flagged: string[] = []
  const seen = new Set<string>()
  for (const { term, substitute } of [...BLOCKED_NARRATIVE_TERMS, ...extraTerms]) {
    const key = String(term || '').toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (substitute) {
      const r = replaceTerm(out, term, substitute)
      out = r.text
      if (r.hit) substituted.push(term)
    } else if (new RegExp(`\\b${escapeRe(term)}\\b`, 'i').test(out)) {
      flagged.push(term) // no substitute — surface it, don't silently remove clinical content
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
