import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string
  const role: string = ((session.user as any).role || '').toLowerCase()
  const isBCBA = ['bcba', 'bcaba'].includes(role)

  // Get client IDs for this user
  let clientIds: string[] = []

  if (isBCBA) {
    const bcbaClients = await prisma.bcba_clients.findMany({
      where: { bcba_id: userId },
      select: { client_id: true },
    })
    clientIds = bcbaClients.map((bc) => bc.client_id)
  } else {
    // RBT / admin
    const clients = await prisma.clients.findMany({
      where: { rbt_id: userId },
      select: { id: true },
    })
    clientIds = clients.map((c) => c.id)
  }

  // Monday of current week at 00:00
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon, ...
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMonday)
  monday.setHours(0, 0, 0, 0)

  const activeClients = clientIds.length

  let notesThisWeek = 0
  let recentActivity: Array<{
    type: 'note'
    clientName: string
    date: string
    sessionDate: string | null
  }> = []

  if (clientIds.length > 0) {
    // Count notes this week
    notesThisWeek = await prisma.session_notes.count({
      where: {
        client_id: { in: clientIds },
        created_at: { gte: monday },
      },
    })

    // Last 5 session notes with client info
    const recent = await prisma.session_notes.findMany({
      where: { client_id: { in: clientIds } },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: {
        created_at: true,
        session_date: true,
        client: { select: { internal_code: true } },
      },
    })

    recentActivity = recent.map((n) => ({
      type: 'note' as const,
      clientName: n.client?.internal_code || 'Unknown Client',
      date: n.created_at ? n.created_at.toISOString() : new Date().toISOString(),
      sessionDate: n.session_date ?? null,
    }))
  }

  return NextResponse.json({ activeClients, notesThisWeek, recentActivity })
}
