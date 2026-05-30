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
  const date = url.searchParams.get('date')
  if (!clientId || !date) return NextResponse.json({ error: 'Missing clientId or date' }, { status: 400 })

  if (!UUID_RE.test(userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { rbt_id: true },
  })

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!connection.rbt_id) return NextResponse.json({ empty: true })

  const note = await prisma.session_notes.findFirst({
    where: { client_id: clientId, user_id: connection.rbt_id, session_date: date },
    select: {
      behaviors_addressed: true,
      skills_addressed: true,
      interventions_used: true,
      activities_used: true,
      note_text: true,
    },
    orderBy: { created_at: 'desc' },
  })

  if (!note) return NextResponse.json({ empty: true })

  return NextResponse.json({
    empty: false,
    behaviors: note.behaviors_addressed || [],
    skills: note.skills_addressed || [],
    interventions: note.interventions_used || [],
    activities: note.activities_used || [],
    noteText: note.note_text || '',
  })
}
