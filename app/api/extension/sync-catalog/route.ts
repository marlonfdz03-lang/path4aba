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

export async function POST(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, source, programs, behaviors, capturedAt, formState } = await req.json().catch(() => ({}))
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
  // Nothing observed -> nothing to persist (a fill that opened no goal/behavior select).
  if (cleanPrograms.length === 0 && cleanBehaviors.length === 0) {
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
  const observedCatalog = { ...(profile.observedCatalog || {}) }
  const prior = observedCatalog[src] || null

  observedCatalog[src] = {
    current: {
      programs: cleanPrograms,
      behaviors: cleanBehaviors,
      capturedAt: typeof capturedAt === 'string' ? capturedAt : new Date().toISOString(),
      capturedBy: user.id,
      formState: cleanFormState,
    },
    // Keep exactly one prior version for diffing (drop its own `previous` to avoid unbounded growth).
    previous: prior ? { ...prior.current } : null,
  }

  await prisma.clients.update({
    where: { id: clientId },
    data: { clinical_profile: { ...profile, observedCatalog } },
  })

  return NextResponse.json({
    ok: true,
    stored: true,
    counts: { programs: cleanPrograms.length, behaviors: cleanBehaviors.length },
  })
}
