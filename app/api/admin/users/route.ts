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

  const search = new URL(req.url).searchParams.get('search') || ''

  const users = await prisma.users.findMany({
    where: search ? { email: { contains: search, mode: 'insensitive' } } : undefined,
    orderBy: { created_at: 'desc' },
    select: { id: true, email: true, name: true, role: true, created_at: true },
  })

  return Response.json({ users })
}

export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id, role } = await req.json()
  if (!id || !role) return Response.json({ error: 'Missing id or role' }, { status: 400 })
  if (!['rbt', 'bcba', 'admin'].includes(role)) return Response.json({ error: 'Invalid role' }, { status: 400 })

  const user = await prisma.users.update({ where: { id }, data: { role } })
  return Response.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } })
}

export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  await prisma.users.delete({ where: { id } })
  return Response.json({ ok: true })
}
