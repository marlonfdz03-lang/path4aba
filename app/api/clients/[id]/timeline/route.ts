import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string
  const { id: clientId } = await params

  const [rbtClient, bcbaConn] = await Promise.all([
    prisma.clients.findFirst({ where: { id: clientId, rbt_id: userId }, select: { id: true } }),
    prisma.bcba_clients.findFirst({ where: { bcba_id: userId, client_id: clientId }, select: { id: true } }),
  ])
  if (!rbtClient && !bcbaConn) {
    return NextResponse.json({ error: 'Not authorized to view this client' }, { status: 403 })
  }

  const typeFilter = new URL(req.url).searchParams.get('type')

  const entries = await prisma.clinical_timeline_entries.findMany({
    where: {
      client_id: clientId,
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json({ entries })
}
