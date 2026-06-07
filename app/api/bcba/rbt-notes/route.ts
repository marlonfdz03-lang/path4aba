import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string
  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  console.log('[rbt-notes] bcba_id:', userId, 'clientId param:', clientId)

  const connections = await prisma.bcba_clients.findMany({
    where: { bcba_id: userId },
    select: { client_id: true },
  })

  console.log('[rbt-notes] bcba_clients connections:', connections.length)

  const clientIds = connections.map(c => c.client_id)
  if (clientIds.length === 0) {
    console.log('[rbt-notes] no connected clients — returning empty')
    return NextResponse.json({ notes: [] })
  }

  const targetIds = clientId ? [clientId] : clientIds
  console.log('[rbt-notes] querying session_notes for client_ids:', targetIds)

  const notes = await prisma.session_notes.findMany({
    where: { client_id: { in: targetIds } },
    select: {
      id: true,
      client_id: true,
      user_id: true,
      note_text: true,
      created_at: true,
      session_date: true,
      behaviors_addressed: true,
      skills_addressed: true,
      interventions_used: true,
      activities_used: true,
      review_status: true,
      reviewed_at: true,
      review_comment: true,
    },
    orderBy: { created_at: 'desc' },
  })

  console.log('[rbt-notes] rows:', notes.length)

  const clients = await prisma.clients.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, internal_code: true, clinical_profile: true },
  })

  const clientMap = Object.fromEntries(
    clients.map(c => [c.id, (c.clinical_profile as any)?.name || c.internal_code || 'Unknown Client'])
  )
  const enriched = notes.map(n => ({
    ...n,
    clientName: clientMap[n.client_id ?? ''] || 'Unknown Client',
  }))

  console.log('[rbt-notes] returning', enriched.length, 'notes')
  return NextResponse.json({ notes: enriched })
}
