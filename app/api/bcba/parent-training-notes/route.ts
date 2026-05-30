import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  if (!UUID_RE.test(userId)) return NextResponse.json({ notes: [] })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { id: true },
  })
  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const notes = await prisma.parent_training_notes.findMany({
    where: { client_id: clientId, bcba_id: userId },
    select: { id: true, session_date: true, caregiver_name: true, caregiver_relation: true, note_text: true, status: true, created_at: true },
    orderBy: { session_date: 'desc' },
  })

  return NextResponse.json({ notes })
}
