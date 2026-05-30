import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ count: 0 })
  const userId = (session.user as any).id as string

  if (!UUID_RE.test(userId)) return NextResponse.json({ count: 0 })

  const connections = await prisma.bcba_clients.findMany({
    where: { bcba_id: userId },
    select: { client_id: true },
  })

  const clientIds = connections.map((c) => c.client_id)
  if (clientIds.length === 0) return NextResponse.json({ count: 0 })

  const count = await prisma.session_notes.count({
    where: {
      client_id: { in: clientIds },
      review_status: 'pending',
    },
  })

  return NextResponse.json({ count })
}
