import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await auth()
  if (!session?.user) return null
  if ((session.user as any).role !== 'admin') return null
  return session
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const [totalUsers, totalClients, totalNotes, totalSubscriptions, recentUsers] = await Promise.all([
    prisma.users.count(),
    prisma.clients.count(),
    // NOT filtered to active on purpose: this is a raw system row-count ("how many note rows exist"), a
    // different question from a clinical corpus. A superseded note is still a row that was written, and this
    // metric is operational, not clinical — so it counts every row, unlike the client-facing readers.
    prisma.session_notes.count(),
    prisma.subscriptions.count({ where: { status: 'active' } }),
    prisma.users.findMany({
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true, email: true, name: true, role: true, created_at: true },
    }),
  ])

  return Response.json({ totalUsers, totalClients, totalNotes, totalSubscriptions, recentUsers })
}
