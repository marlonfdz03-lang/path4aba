import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const date = url.searchParams.get('date')
  if (!clientId || !date) return NextResponse.json({ error: 'Missing clientId or date' }, { status: 400 })

  // Find the BCBA connected to this RBT's client
  const connection = await prisma.bcba_clients.findFirst({
    where: { client_id: clientId, rbt_id: user.id },
    select: { bcba_id: true },
  })

  if (!connection?.bcba_id) return NextResponse.json({ empty: true })

  // Check if BCBA already generated a 97153XP note for this date
  const xpNote = await prisma.supervision_notes_97153xp.findFirst({
    where: { client_id: clientId, bcba_id: connection.bcba_id, session_date: date },
    select: { note_text: true, rbt_session_context: true },
    orderBy: { created_at: 'desc' },
  })

  if (!xpNote) return NextResponse.json({ empty: true })

  // Extract behaviors, skills, interventions from the rbt_session_context if available
  const ctx = xpNote.rbt_session_context as any

  return NextResponse.json({
    empty: false,
    noteText: xpNote.note_text || '',
    behaviors: ctx?.behaviors || [],
    skills: ctx?.skills || [],
    interventions: ctx?.interventions || [],
  })
}
