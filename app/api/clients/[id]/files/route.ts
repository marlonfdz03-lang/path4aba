import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { userOwnsClient } from '@/lib/clientFiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/clients/[id]/files — list stored source PDFs for a client (METADATA ONLY; never the bytes).
// Ownership-checked (rbt_id OR bcba_clients → 403), so this is NOT reachable via the clients/[id] IDOR.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await userOwnsClient(userId, id))) {
    return NextResponse.json({ error: 'Not authorized to view this client' }, { status: 403 })
  }

  // Never select `data` — a list must not pull every PDF's bytes.
  const files = await prisma.client_files.findMany({
    where: { client_id: id },
    select: { id: true, filename: true, mime_type: true, size_bytes: true, uploaded_at: true, uploaded_by: true },
    orderBy: { uploaded_at: 'desc' },
  })
  return NextResponse.json({ files })
}
