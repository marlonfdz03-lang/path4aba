import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { canonicalKey, unionCI, LibraryKind } from '@/lib/clinicalLibrary'
import { tokenSubsetMatch } from '@/lib/skillReconcile'

export const dynamic = 'force-dynamic'

// Admin-only, same guard as the rest of the admin API. These rows are the curated clinical corpus for the
// future Assessment Builder — deduplicated vocabulary (behavior/skill/procedure/reinforcer/activity names,
// topography variants, function labels). No note text, no client identifiers — the PHI filter discarded any
// identifier before storage — so it stays behind this admin check like the other panels.
async function requireAdmin() {
  const session = await auth()
  if (!session?.user) return null
  if ((session.user as any).role !== 'admin') return null
  return session
}

const KINDS: LibraryKind[] = ['behavior', 'skill', 'procedure', 'reinforcer', 'activity']

// A stored library row.
interface Row {
  id: string
  kind: string
  canonical_key: string
  display_name: string
  variants: string[]
  functions: string[]
  meta: any
  updated_at: Date
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const rows: Row[] = await (prisma as any).clinical_library.findMany({
      orderBy: [{ kind: 'asc' }, { display_name: 'asc' }],
      take: 5000,
    })

    // Merge suggestions: within a kind, pairs whose display names token-subset-match — near-dups the
    // canonical key missed (e.g. "Break Request" vs "Requesting a Break to Leave"). The admin decides;
    // we only surface candidates. Structural (tokenSubsetMatch), no threshold.
    const suggestions: { kind: string; a: { id: string; name: string }; b: { id: string; name: string } }[] = []
    for (const kind of KINDS) {
      const inKind = rows.filter((r) => r.kind === kind)
      for (let i = 0; i < inKind.length; i++) {
        for (let j = i + 1; j < inKind.length; j++) {
          const a = inKind[i], b = inKind[j]
          if (a.canonical_key === b.canonical_key) continue // already the same key (shouldn't happen — unique)
          if (tokenSubsetMatch(a.display_name, b.display_name)) {
            suggestions.push({ kind, a: { id: a.id, name: a.display_name }, b: { id: b.id, name: b.display_name } })
          }
        }
      }
    }

    // Discard-log summary: counts by (kind, reason) so Marlon can see the PHI filter working and spot
    // over-firing. Never the text — the discard table only ever stored kind + reason.
    let discards: { kind: string; reason: string; count: number }[] = []
    try {
      const grouped = await (prisma as any).clinical_library_discards.groupBy({
        by: ['kind', 'reason'],
        _count: { _all: true },
      })
      discards = grouped
        .map((g: any) => ({ kind: g.kind, reason: g.reason, count: g._count?._all ?? 0 }))
        .sort((a: any, b: any) => b.count - a.count)
    } catch { /* discard table missing — leave empty */ }

    return Response.json({
      kinds: KINDS,
      entries: rows.map((r) => ({
        id: r.id, kind: r.kind, canonicalKey: r.canonical_key, displayName: r.display_name,
        variants: r.variants || [], functions: r.functions || [], meta: r.meta ?? null,
        updatedAt: r.updated_at,
      })),
      suggestions,
      discards,
      discardTotal: discards.reduce((s, d) => s + d.count, 0),
    })
  } catch (e: any) {
    // Tables are created by a manual psql migration. Until then, report plainly rather than 500ing.
    return Response.json(
      { error: 'clinical_library unavailable', details: e?.message || String(e), pendingMigration: true },
      { status: 200 },
    )
  }
}

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad request' }, { status: 400 }) }
  const action = String(body?.action || '')

  try {
    if (action === 'update') {
      // Edit display_name and/or replace the variants/functions arrays (the client submits the full new
      // array after editing or removing individual entries). display_name change re-derives canonical_key,
      // guarding against colliding with another row of the same kind.
      const id = String(body.id || '')
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const cur: Row | null = await (prisma as any).clinical_library.findUnique({ where: { id } })
      if (!cur) return Response.json({ error: 'Not found' }, { status: 404 })

      const data: any = {}
      if (typeof body.displayName === 'string' && body.displayName.trim()) {
        const name = body.displayName.trim()
        const key = canonicalKey(name)
        if (!key) return Response.json({ error: 'Name normalizes to empty' }, { status: 400 })
        if (key !== cur.canonical_key) {
          const clash = await (prisma as any).clinical_library.findFirst({
            where: { kind: cur.kind, canonical_key: key, id: { not: id } }, select: { id: true, display_name: true },
          })
          if (clash) return Response.json({ error: `That name collides with "${clash.display_name}" — merge instead.` }, { status: 409 })
        }
        data.display_name = name
        data.canonical_key = key
      }
      if (Array.isArray(body.variants)) data.variants = unionCI(body.variants.map(String))
      if (Array.isArray(body.functions)) data.functions = unionCI(body.functions.map(String))
      const updated = await (prisma as any).clinical_library.update({ where: { id }, data })
      return Response.json({ ok: true, entry: updated })
    }

    if (action === 'merge') {
      // Fold `sourceId` into `targetId`: union variants + functions into target, delete source. The remedy
      // for near-dups the key missed. target keeps its own display_name/canonical_key.
      const sourceId = String(body.sourceId || ''), targetId = String(body.targetId || '')
      if (!sourceId || !targetId || sourceId === targetId) return Response.json({ error: 'two distinct ids required' }, { status: 400 })
      const [src, tgt]: [Row | null, Row | null] = await Promise.all([
        (prisma as any).clinical_library.findUnique({ where: { id: sourceId } }),
        (prisma as any).clinical_library.findUnique({ where: { id: targetId } }),
      ])
      if (!src || !tgt) return Response.json({ error: 'Not found' }, { status: 404 })
      if (src.kind !== tgt.kind) return Response.json({ error: 'Cannot merge across kinds' }, { status: 400 })
      await (prisma as any).clinical_library.update({
        where: { id: targetId },
        data: {
          variants: unionCI([...(tgt.variants || []), src.display_name, ...(src.variants || [])]),
          functions: unionCI([...(tgt.functions || []), ...(src.functions || [])]),
        },
      })
      await (prisma as any).clinical_library.delete({ where: { id: sourceId } })
      return Response.json({ ok: true })
    }

    if (action === 'split') {
      // Two distinct concepts were wrongly collapsed into one row: move the named variants out into a NEW
      // row (same kind) under a new display name. The moved variants are removed from the original.
      const id = String(body.id || '')
      const newName = String(body.newDisplayName || '').trim()
      const move: string[] = Array.isArray(body.variantsToMove) ? body.variantsToMove.map(String) : []
      if (!id || !newName || !move.length) return Response.json({ error: 'id, newDisplayName, variantsToMove required' }, { status: 400 })
      const cur: Row | null = await (prisma as any).clinical_library.findUnique({ where: { id } })
      if (!cur) return Response.json({ error: 'Not found' }, { status: 404 })
      const key = canonicalKey(newName)
      if (!key) return Response.json({ error: 'Name normalizes to empty' }, { status: 400 })
      const clash = await (prisma as any).clinical_library.findFirst({ where: { kind: cur.kind, canonical_key: key }, select: { id: true } })
      if (clash) return Response.json({ error: 'A row with that name already exists in this kind — merge into it instead.' }, { status: 409 })

      const moveSet = new Set(move.map((m) => m.toLowerCase()))
      const remaining = (cur.variants || []).filter((v) => !moveSet.has(v.toLowerCase()))
      const moved = (cur.variants || []).filter((v) => moveSet.has(v.toLowerCase()))
      await (prisma as any).clinical_library.create({
        data: { kind: cur.kind, canonical_key: key, display_name: newName, variants: unionCI(moved), functions: [], meta: cur.meta ?? undefined },
      })
      await (prisma as any).clinical_library.update({ where: { id }, data: { variants: remaining } })
      return Response.json({ ok: true })
    }

    if (action === 'delete') {
      const id = String(body.id || '')
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      await (prisma as any).clinical_library.delete({ where: { id } })
      return Response.json({ ok: true })
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
