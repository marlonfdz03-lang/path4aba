import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id

  const rows = UUID_RE.test(userId)
    ? await prisma.clients.findMany({
        where: { rbt_id: userId },
        select: { id: true, internal_code: true, clinical_profile: true },
        orderBy: { created_at: 'desc' },
      })
    : []

  const clientList = rows.map(row => ({
    id: row.id,
    client_name: (row.clinical_profile as any)?.name || row.internal_code || 'Unknown Client',
    internal_code: row.internal_code,
    clinical_profile: row.clinical_profile,
  }))

  return NextResponse.json({ clients: clientList, data_tab_enabled: user.data_tab_enabled })
}
