import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Admin-only, same guard as the rest of the admin API. These rows carry client ids and short clinical
// labels (behavior names, intervention names) — no note text — so they stay behind this check.
async function requireAdmin() {
  const session = await auth()
  if (!session?.user) return null
  if ((session.user as any).role !== 'admin') return null
  return session
}

export async function GET(req: Request) {
  const session = await requireAdmin()
  if (!session) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 7, 1), 90)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  try {
    const rows = await prisma.gate_findings.findMany({
      where: { created_at: { gte: since } },
      orderBy: { created_at: 'desc' },
      take: 500,
      select: {
        id: true, created_at: true, client_id: true, user_id: true,
        source: true, gate: true, severity: true, detail: true, regen_count: true,
      },
    })

    // Grouped by gate + severity so a RECURRING defect is obvious rather than buried in a feed —
    // the point of the panel is finding root causes, not reading individual incidents.
    const groups = new Map<string, {
      gate: string; severity: string; count: number
      clients: Set<string>; users: Set<string>; examples: string[]; lastSeen: Date
    }>()
    for (const r of rows) {
      const key = `${r.gate}|${r.severity}`
      const g = groups.get(key) ?? {
        gate: r.gate, severity: r.severity, count: 0,
        clients: new Set<string>(), users: new Set<string>(), examples: [], lastSeen: r.created_at,
      }
      g.count += 1
      if (r.client_id) g.clients.add(r.client_id)
      if (r.user_id) g.users.add(r.user_id)
      if (g.examples.length < 3 && !g.examples.includes(r.detail)) g.examples.push(r.detail)
      if (r.created_at > g.lastSeen) g.lastSeen = r.created_at
      groups.set(key, g)
    }

    const grouped = [...groups.values()]
      .map((g) => ({
        gate: g.gate, severity: g.severity, count: g.count,
        clientCount: g.clients.size, userCount: g.users.size,
        examples: g.examples, lastSeen: g.lastSeen,
      }))
      // Critical first, then by how often it recurs — the two things that decide what to fix next.
      .sort((a, b) =>
        (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) || b.count - a.count)

    return Response.json({
      days,
      total: rows.length,
      criticalCount: rows.filter((r) => r.severity === 'critical').length,
      grouped,
      recent: rows.slice(0, 100),
    })
  } catch (e: any) {
    // The table is created by a manual psql migration. Until it is run, report that plainly rather
    // than 500ing — the panel is diagnostics and must never look like a broken app.
    return Response.json(
      { error: 'gate_findings unavailable', details: e?.message || String(e), pendingMigration: true },
      { status: 200 },
    )
  }
}
