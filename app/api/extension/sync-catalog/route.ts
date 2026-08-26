import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

// Passive live-catalog sync (Phase 1). The extension captures the client's current program and
// behavior lists from the host-EHR selects a fill already opened, and posts them here. We store
// them under clinical_profile.observedCatalog[source], overwriting `current` each time and keeping
// the prior `current` as `previous` so a diff against the (reassessment-derived) profile is
// possible. This route NEVER writes to clinical_profile's own program lists — it only records what
// was observed. No PHI beyond the client id and treatment-plan labels.
//
// Auth: Bearer token (extension). The client must belong to this user, as an RBT (clients.rbt_id)
// or a BCBA (bcba_clients join).

const MAX_ITEMS = 200
const MAX_LEN = 200

// Sanitize an incoming label list: strings only, trimmed, de-duped, bounded.
function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.trim().slice(0, MAX_LEN)
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

// Sanitize the per-behavior function map { behaviorName: options[] }: bounded, string keys/values,
// empty lists and empty keys dropped. Returns undefined when nothing usable (so `current` omits it and
// consumers fall back to the global `functions` union — no regression).
function cleanFunctionsByBehavior_(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string[]> = {}
  let n = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || '').trim().slice(0, MAX_LEN)
    if (!key) continue
    const opts = cleanList(v)
    if (!opts.length) continue
    out[key] = opts
    if (++n >= MAX_ITEMS) break
  }
  return n ? out : undefined
}

export async function POST(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, source, programs, behaviors, functions, functionsByBehavior, blockedTerms, capturedAt, formState, teachingProcedureRequired } = await req.json().catch(() => ({}))
  // Whether ABA Matrix marks the teaching-procedure field required (Commit 4 auto-capture). Tri-state:
  // true/false observed, null = the fill couldn't tell (field absent) — never coerce null to false.
  const tpRequired: boolean | null = typeof teachingProcedureRequired === 'boolean' ? teachingProcedureRequired : null
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }

  // Form-population snapshot at capture time (bounded, numeric-only) — evidence for whether the
  // observed catalog is complete or a filtered subset.
  const cleanFormState = formState && typeof formState === 'object'
    ? {
        goalsTotal: Math.max(0, Math.min(999, Number(formState.goalsTotal) || 0)),
        goalsPopulated: Math.max(0, Math.min(999, Number(formState.goalsPopulated) || 0)),
        behaviorsTotal: Math.max(0, Math.min(999, Number(formState.behaviorsTotal) || 0)),
        behaviorsPopulated: Math.max(0, Math.min(999, Number(formState.behaviorsPopulated) || 0)),
      }
    : null

  const src = typeof source === 'string' && source.trim() ? source.trim().slice(0, 40) : 'aba_matrix'
  const cleanPrograms = cleanList(programs)
  const cleanBehaviors = cleanList(behaviors)
  const cleanFunctions = cleanList(functions)
  const cleanFunctionsByBehavior = cleanFunctionsByBehavior_(functionsByBehavior)
  const cleanBlocked = cleanList(blockedTerms).map((t) => t.toLowerCase())
  const hasCatalog = cleanPrograms.length > 0 || cleanBehaviors.length > 0 || cleanFunctions.length > 0 || !!cleanFunctionsByBehavior
  // Nothing observed -> nothing to persist.
  if (!hasCatalog && cleanBlocked.length === 0) {
    return NextResponse.json({ ok: true, stored: false })
  }

  // Authorize: the caller must own this client as its RBT or be a linked BCBA.
  const client = await prisma.clients.findFirst({
    where: {
      id: clientId,
      OR: [
        { rbt_id: user.id },
        { bcba_clients: { some: { bcba_id: user.id } } },
      ],
    },
    select: { id: true, clinical_profile: true },
  })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const profile = (client.clinical_profile as any) || {}
  const nextProfile: any = { ...profile }

  // Program/behavior/function catalog (only when catalog data was observed).
  if (hasCatalog) {
    const observedCatalog = { ...(profile.observedCatalog || {}) }
    const prior = observedCatalog[src] || null
    observedCatalog[src] = {
      current: {
        programs: cleanPrograms,
        behaviors: cleanBehaviors,
        functions: cleanFunctions,
        // Per-behavior dropdowns (each behavior's own function options). Omitted when the capture didn't
        // provide any — consumers then fall back to the `functions` union (matrixFunctionsForBehavior).
        ...(cleanFunctionsByBehavior ? { functionsByBehavior: cleanFunctionsByBehavior } : {}),
        capturedAt: typeof capturedAt === 'string' ? capturedAt : new Date().toISOString(),
        capturedBy: user.id,
        formState: cleanFormState,
        teachingProcedureRequired: tpRequired,
      },
      // Keep exactly one prior version for diffing (drop its own `previous` to avoid unbounded growth).
      previous: prior ? { ...prior.current } : null,
    }
    nextProfile.observedCatalog = observedCatalog
  }

  // Learned host-blocked narrative terms (e.g. "sensory") captured from validation messages. Merge
  // additively; never clobber an existing entry that already has a substitute. Learned terms carry
  // no substitute -> the note generator FLAGS them to the RBT rather than substituting blindly.
  if (cleanBlocked.length > 0) {
    const existing: any[] = Array.isArray(profile.blockedNarrativeTerms) ? profile.blockedNarrativeTerms : []
    const byTerm = new Map<string, { term: string; substitute: string | null }>()
    for (const e of existing) {
      const term = typeof e === 'string' ? e : e?.term
      if (term) byTerm.set(String(term).toLowerCase(), typeof e === 'string' ? { term, substitute: null } : { term: e.term, substitute: e.substitute ?? null })
    }
    for (const term of cleanBlocked) {
      if (!byTerm.has(term)) byTerm.set(term, { term, substitute: null })
    }
    nextProfile.blockedNarrativeTerms = [...byTerm.values()]

    // SHARED SET (global): also record each capture in blocked_narrative_terms so it protects EVERY client,
    // not just this one. Fail-soft: if the table isn't present yet (migration not run), the per-client write
    // above still applies. ON CONFLICT DO NOTHING — never clobber a seeded substitute.
    for (const term of cleanBlocked) {
      try {
        await (prisma as any).$executeRawUnsafe(
          'INSERT INTO blocked_narrative_terms (term, substitute, source) VALUES ($1, NULL, $2) ON CONFLICT (term) DO NOTHING',
          term, 'learned',
        )
      } catch { /* table not present yet — per-client write above is the fallback */ }
    }
  }

  await prisma.clients.update({
    where: { id: clientId },
    data: { clinical_profile: nextProfile },
  })

  return NextResponse.json({
    ok: true,
    stored: true,
    counts: { programs: cleanPrograms.length, behaviors: cleanBehaviors.length },
  })
}
