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

export async function GET() {
  if (!await requireAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const subs = await prisma.subscriptions.findMany({
    orderBy: { created_at: 'desc' },
  })

  const userIds = [...new Set(subs.map(s => s.user_id))]
  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true },
  })
  const userMap = new Map(users.map(u => [u.id, u]))

  const result = subs.map(s => ({
    ...s,
    user_email: userMap.get(s.user_id)?.email || s.user_id,
    user_name: userMap.get(s.user_id)?.name || null,
  }))

  return Response.json({ subscriptions: result })
}

export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id, plan, status } = await req.json()
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const data: any = {}
  if (plan !== undefined) data.plan = plan
  if (status !== undefined) data.status = status

  const sub = await prisma.subscriptions.update({ where: { id }, data })
  return Response.json({ ok: true, subscription: sub })
}
