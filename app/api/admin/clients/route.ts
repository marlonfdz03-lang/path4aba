import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await auth()
  if (!session?.user) return null
  if ((session.user as any).role !== 'admin') return null
  return session
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const rbtId = new URL(req.url).searchParams.get('rbtId') || undefined

  const clients = await prisma.clients.findMany({
    where: rbtId ? { rbt_id: rbtId } : undefined,
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      internal_code: true,
      rbt_id: true,
      primary_setting: true,
      created_at: true,
      clinical_profile: true,
      bcba_clients: { select: { bcba_id: true } },
      _count: { select: { session_notes: true } },
    },
  })

  const rbtIds = [...new Set(clients.map(c => c.rbt_id).filter(Boolean))] as string[]
  const rbts = rbtIds.length > 0
    ? await prisma.users.findMany({
        where: { id: { in: rbtIds } },
        select: { id: true, email: true, name: true },
      })
    : []
  const rbtMap = new Map(rbts.map(r => [r.id, r]))

  const result = clients.map(c => ({
    id: c.id,
    internal_code: c.internal_code,
    client_name: (c.clinical_profile as any)?.name || c.internal_code || 'Unknown',
    rbt_id: c.rbt_id,
    rbt_email: c.rbt_id ? rbtMap.get(c.rbt_id)?.email || null : null,
    rbt_name: c.rbt_id ? rbtMap.get(c.rbt_id)?.name || null : null,
    primary_setting: c.primary_setting,
    bcba_count: c.bcba_clients.length,
    note_count: c._count.session_notes,
    created_at: c.created_at,
  }))

  return Response.json({ clients: result })
}
