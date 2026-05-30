import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  console.log('[missing-hours] bcba_id:', userId, 'clientId param:', clientId)

  if (!UUID_RE.test(userId)) {
    console.log('[missing-hours] non-UUID user — returning empty')
    return NextResponse.json({ entries: [] })
  }

  const connections = await prisma.bcba_clients.findMany({
    where: { bcba_id: userId },
    select: { client_id: true },
  })

  console.log('[missing-hours] bcba_clients connections:', connections.length)

  const clientIds = connections.map(c => c.client_id)
  if (clientIds.length === 0) {
    console.log('[missing-hours] no connected clients — returning empty')
    return NextResponse.json({ entries: [] })
  }

  const targetIds = clientId ? [clientId] : clientIds
  console.log('[missing-hours] querying missed_hours for client_ids:', targetIds)

  let entries: any[] = []
  try {
    entries = await prisma.missed_hours.findMany({
      where: { client_id: { in: targetIds } },
      select: { id: true, client_id: true, date: true, reason: true, hours: true, notes: true, created_at: true },
      orderBy: { date: 'desc' },
    })
    console.log('[missing-hours] rows:', entries.length)
  } catch (e: any) {
    console.error('[missing-hours] DB error:', e.message)
    return NextResponse.json({ entries: [] })
  }

  const clients = await prisma.clients.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, internal_code: true, clinical_profile: true },
  })

  const clientMap = Object.fromEntries(
    clients.map(c => [c.id, (c.clinical_profile as any)?.name || c.internal_code || 'Unknown Client'])
  )
  const enriched = entries.map(e => ({ ...e, clientName: clientMap[e.client_id ?? ''] || 'Unknown Client' }))

  console.log('[missing-hours] returning', enriched.length, 'entries')
  return NextResponse.json({ entries: enriched })
}
