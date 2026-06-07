import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'


export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  let body: { noteId?: string; status?: 'accepted' | 'rejected'; comment?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { noteId, status, comment } = body
  if (!noteId || !status || !['accepted', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Missing or invalid noteId or status' }, { status: 400 })
  }


  const note = await prisma.session_notes.findFirst({
    where: { id: noteId },
    select: { client_id: true },
  })

  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: note.client_id! },
    select: { id: true },
  })

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await prisma.session_notes.update({
      where: { id: noteId },
      data: {
        review_status: status,
        reviewed_by: userId,
        reviewed_at: new Date(),
        review_comment: comment || null,
      },
    })
  } catch (e) {
    console.error('[bcba/review-note]', e)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
