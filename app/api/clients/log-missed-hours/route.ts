import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'


export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string


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
