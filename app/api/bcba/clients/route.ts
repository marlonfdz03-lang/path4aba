import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id
  if (!UUID_RE.test(userId)) return NextResponse.json({ clients: [] })

  console.log('[bcba/clients] fetching clients for bcba_id:', userId)

  const rows = await prisma.bcba_clients.findMany({
    where: { bcba_id: userId },
    select: { client_id: true, rbt_id: true, connected_at: true },
    orderBy: { connected_at: 'desc' },
  })

  console.log('[bcba/clients] found', rows.length, 'connections')

  if (rows.length === 0) return NextResponse.json({ clients: [] })

  const clientIds = rows.map(r => r.client_id)

  const clientRows = await prisma.clients.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, internal_code: true, clinical_profile: true },
  })

  console.log('[bcba/clients] client rows fetched:', clientRows.length)

  const clientMap = new Map(clientRows.map(c => [c.id, c]))

  const clients = rows.map(row => {
    const clientRow = clientMap.get(row.client_id)
    return {
      id: row.client_id,
      client_name: (clientRow?.clinical_profile as any)?.name || clientRow?.internal_code || 'Unknown Client',
      diagnosis: (clientRow?.clinical_profile as any)?.maladaptiveBehaviors?.map((b: any) => b.name).slice(0, 2) || [],
      connected_at: row.connected_at,
      rbt_id: row.rbt_id,
    }
  })

  return NextResponse.json({ clients, data_tab_enabled: user.data_tab_enabled })
}
