import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { userOwnsClient } from '@/lib/clientFiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/clients/[id]/files/[fileId] — download one stored PDF. Ownership-checked; the ONLY way the
// bytes are served (no public/pre-signed URL, ever). Verifies the file belongs to [id] so a file id from
// another client cannot be fetched through this client's path.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await auth()
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, fileId } = await params
  if (!(await userOwnsClient(userId, id))) {
    return NextResponse.json({ error: 'Not authorized to view this client' }, { status: 403 })
  }

  const file = await prisma.client_files.findUnique({ where: { id: fileId } })
  if (!file || file.client_id !== id) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const bytes = file.data as unknown as Uint8Array
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': file.mime_type || 'application/pdf',
      'Content-Disposition': `inline; filename="${(file.filename || 'assessment.pdf').replace(/["\r\n]/g, '')}"`,
      'Content-Length': String(file.size_bytes),
      // PHI at rest in the client: this is an un-redacted assessment PDF (name/DOB/possibly Medicaid ID). It must
      // not linger in a browser disk cache or any shared/proxy cache after viewing. no-store forbids writing it to
      // any cache; private + max-age=0 are belt-and-suspenders for intermediaries that ignore no-store.
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    },
  })
}

// DELETE /api/clients/[id]/files/[fileId] — remove one stored PDF. Ownership-checked; same client-scope
// verification as download.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await auth()
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, fileId } = await params
  if (!(await userOwnsClient(userId, id))) {
    return NextResponse.json({ error: 'Not authorized to view this client' }, { status: 403 })
  }

  const file = await prisma.client_files.findUnique({ where: { id: fileId }, select: { id: true, client_id: true } })
  if (!file || file.client_id !== id) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  await prisma.client_files.delete({ where: { id: fileId } })
  return NextResponse.json({ ok: true })
}
