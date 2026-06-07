import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id

  const rows = await prisma.clients.findMany({
    where: { rbt_id: userId },
    select: { id: true, internal_code: true, clinical_profile: true },
    orderBy: { created_at: 'desc' },
  })

  const clientList = rows.map(row => ({
    id: row.id,
    client_name: (row.clinical_profile as any)?.name || row.internal_code || 'Unknown Client',
    internal_code: row.internal_code,
    clinical_profile: row.clinical_profile,
  }))

  return NextResponse.json({ clients: clientList, data_tab_enabled: user.data_tab_enabled })
}
