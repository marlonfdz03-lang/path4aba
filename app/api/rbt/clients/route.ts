import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string

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

  return NextResponse.json({ clients: clientList })
}
