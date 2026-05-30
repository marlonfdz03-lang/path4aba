import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  if (!UUID_RE.test(userId)) return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })

  const body = await req.json()
  const { client_id, date, reason, hours, notes } = body

  if (!client_id || !date || !reason) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  await prisma.missed_hours.create({
    data: {
      client_id,
      rbt_id: userId,
      date,
      reason,
      hours: hours ?? null,
      notes: notes ?? null,
    },
  })

  return NextResponse.json({ success: true })
}
