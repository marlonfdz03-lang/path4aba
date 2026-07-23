// Tolerant catalog matcher (Phase 2 — the instrument that proves the matcher before Phase 3 is
// allowed to gate note content). Given a profile list (from the reassessment-derived
// clinical_profile) and an observed list (captured live from the host EHR), it produces a diff
// that EXPOSES ITS REASONING: every pairing records what matched what and by which method
// (exact / normalized / token-overlap + score), and unmatched items are surfaced on BOTH sides.
// Nothing here modifies data — it only explains agreement and disagreement.

export type MatchMethod = 'exact' | 'normalized' | 'token-overlap'

export interface CatalogMatch {
  profile: string
  observed: string
  method: MatchMethod
  score: number          // 1 for exact/normalized; Jaccard overlap for token-overlap
  normProfile: string
  normObserved: string
}

export interface CatalogUnmatched {
  item: string
  normalized: string
}

export interface CatalogDiff {
  matched: CatalogMatch[]
  onlyInProfile: CatalogUnmatched[]   // in profile, absent from EHR -> maybe mastered/discontinued
  onlyInObserved: CatalogUnmatched[]  // offered by EHR, absent from profile -> maybe added since reassessment
  normalized: { profile: string[]; observed: string[] } // for DEBUG tracing
}

// Token-overlap acceptance threshold. Deliberately conservative (precision over recall): a MISSED
// pairing shows up as both-sides-unmatched (safe, visible), whereas a FALSE pairing is the failure
// mode we're trying to make impossible to hide. Raise/lower here in one place.
const TOKEN_OVERLAP_THRESHOLD = 0.5

// Transparent normalization: lowercase, strip punctuation, collapse whitespace. No stemming or
// synonyms — keep it inspectable. IMPORTANT: parenthetical CONTENT is kept (only the paren chars
// are removed), because the parenthetical is usually the alias that matches the EHR's short name —
// "Requesting (Manding)" -> "requesting manding" so it can token-match "Manding". (Stripping the
// whole parenthetical was a real false-split this instrument caught.)
export function normalizeLabel(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'with', 'for', 'in', 'on', 'program', 'programs',
  'skill', 'skills', 'goal', 'goals', 'target', 'targets', 'behavior', 'behaviors',
])
function tokens(norm: string): string[] {
  return norm.split(' ').filter((t) => t.length >= 3 && !STOP.has(t))
}
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sa = new Set(a), sb = new Set(b)
  let inter = 0
  sa.forEach((t) => { if (sb.has(t)) inter++ })
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : inter / union
}

// Compute the tolerant diff. `debug` logs the normalized forms + every decision so a wrong pairing
// can be traced without guessing.
export function diffCatalog(
  profileItems: string[],
  observedItems: string[],
  opts?: { debug?: boolean; label?: string },
): CatalogDiff {
  const prof = profileItems.map((s) => String(s || '').trim()).filter(Boolean)
  const obs = observedItems.map((s) => String(s || '').trim()).filter(Boolean)
  const pNorm = prof.map(normalizeLabel)
  const oNorm = obs.map(normalizeLabel)
  const pTok = pNorm.map(tokens)
  const oTok = oNorm.map(tokens)

  const usedProfile = new Array(prof.length).fill(false)
  const usedObserved = new Array(obs.length).fill(false)
  const matched: CatalogMatch[] = []

  const record = (pi: number, oi: number, method: MatchMethod, score: number) => {
    usedProfile[pi] = true
    usedObserved[oi] = true
    matched.push({
      profile: prof[pi], observed: obs[oi], method, score,
      normProfile: pNorm[pi], normObserved: oNorm[oi],
    })
  }

  // Pass 1 — exact (raw, case-insensitive trim).
  for (let pi = 0; pi < prof.length; pi++) {
    for (let oi = 0; oi < obs.length; oi++) {
      if (usedObserved[oi]) continue
      if (prof[pi].toLowerCase() === obs[oi].toLowerCase()) { record(pi, oi, 'exact', 1); break }
    }
  }
  // Pass 2 — normalized equality.
  for (let pi = 0; pi < prof.length; pi++) {
    if (usedProfile[pi]) continue
    for (let oi = 0; oi < obs.length; oi++) {
      if (usedObserved[oi]) continue
      if (pNorm[pi] && pNorm[pi] === oNorm[oi]) { record(pi, oi, 'normalized', 1); break }
    }
  }
  // Pass 3 — token-overlap (greedy best score above threshold). This is the FUZZY tier; its score
  // is surfaced so a reviewer can scrutinize each such pairing.
  for (let pi = 0; pi < prof.length; pi++) {
    if (usedProfile[pi]) continue
    let bestOi = -1, bestScore = 0
    for (let oi = 0; oi < obs.length; oi++) {
      if (usedObserved[oi]) continue
      const s = jaccard(pTok[pi], oTok[oi])
      if (s > bestScore) { bestScore = s; bestOi = oi }
    }
    if (bestOi >= 0 && bestScore >= TOKEN_OVERLAP_THRESHOLD) {
      record(pi, bestOi, 'token-overlap', Number(bestScore.toFixed(2)))
    }
  }

  const onlyInProfile: CatalogUnmatched[] = []
  for (let pi = 0; pi < prof.length; pi++) if (!usedProfile[pi]) onlyInProfile.push({ item: prof[pi], normalized: pNorm[pi] })
  const onlyInObserved: CatalogUnmatched[] = []
  for (let oi = 0; oi < obs.length; oi++) if (!usedObserved[oi]) onlyInObserved.push({ item: obs[oi], normalized: oNorm[oi] })

  const diff: CatalogDiff = { matched, onlyInProfile, onlyInObserved, normalized: { profile: pNorm, observed: oNorm } }

  if (opts?.debug) {
    // Program/behavior labels are treatment-plan names, not clinical content — safe to log.
    // eslint-disable-next-line no-console
    console.log('[catalogDiff]', opts.label || '', {
      normalized: diff.normalized,
      matched: matched.map((m) => `${m.profile} == ${m.observed} [${m.method}${m.method === 'token-overlap' ? ' ' + m.score : ''}]`),
      onlyInProfile: onlyInProfile.map((u) => u.item),
      onlyInObserved: onlyInObserved.map((u) => u.item),
    })
  }
  return diff
}
