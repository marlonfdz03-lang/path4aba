// BEHAVIOR NAMING CHECK — MEASUREMENT ONLY. Deterministic, record-only. Turns "does the finished note
// contain each selected behavior's plan name, exactly as written?" into an admin-only gate_findings row.
// NEVER a repair, never an RBT flag, never a gate. No model, no second call — a pure string test.
//
// VERBATIM ONLY, deliberately. This is the ONE bar that is unambiguous: a case-insensitive substring of
// the plan's exact name. We do NOT also record a partial/token match, because the token filter drops short
// but meaningful words (a 3-char "ear" from "Ear Covering", the alias "SIB") — a token present/absent
// reading is noisy, and a future reader would mistake that second number for a measurement. Verbatim
// UNDER-counts (a paraphrase reads as absent) but it never lies about what it counted.
//
// For a name carrying a parenthetical alias ("Self-Injurious Behavior (SIB)"), any of the plan's OWN exact
// strings counts as verbatim — the full name, the name with the parenthetical removed, or the alias inside
// it. These are all the plan's literal words; this is NOT token splitting or paraphrase matching.
//
// WHAT THIS NUMBER DOES NOT DISTINGUISH — and it matters: a behavior absent because the model PARAPHRASED
// it (documented by topography, e.g. "covered his ears" for "Ear Covering") from a behavior absent because
// it was NEVER DOCUMENTED at all. The first is a NAMING problem; the second is a COVERAGE problem. A string
// match cannot tell them apart — separating them needs a semantic read we do not trust (see the ABC-episode
// discussion). Read this strictly as "named verbatim vs not", NEVER as "documented vs not".
//
// Pure + import-free of prisma/openai so it is unit-testable on bare node.
import type { GateFinding } from './gateFindings.ts'

// The plan's own verbatim forms of a name: the full string, plus (when a trailing parenthetical alias is
// present) the name without it and the alias itself. All are the plan's literal words.
export function verbatimForms(name: string): string[] {
  const out = [name.trim()]
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (m) {
    const base = m[1].trim(), alias = m[2].trim()
    if (base) out.push(base)
    if (alias) out.push(alias)
  }
  return out.filter(Boolean)
}

// PURE. One record-only finding: which selected behaviors appear verbatim in the note, which do not, and
// the count. Returns [] when there are no behaviors to check. Never throws.
export function behaviorNamingFindings(note: string, behaviorNames: string[]): GateFinding[] {
  const names = (behaviorNames || []).map((n) => (n || '').trim()).filter(Boolean)
  if (!names.length) return []
  const low = String(note || '').toLowerCase()
  const named: string[] = []
  const notNamed: string[] = []
  for (const n of names) {
    const hit = verbatimForms(n).some((f) => low.includes(f.toLowerCase()))
    ;(hit ? named : notNamed).push(n)
  }
  return [{
    gate: 'behavior_naming',
    severity: 'info',
    detail: `Behaviors named verbatim: ${named.length}/${names.length}${notNamed.length ? ` — not named: ${notNamed.join(', ')}` : ''} (verbatim-only; does NOT distinguish paraphrase from omission).`,
    context: { total: names.length, namedCount: named.length, named, notNamed },
  }]
}
