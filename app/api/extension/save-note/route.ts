import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'


function calculateSimilarity(a: string, b: string): number {
  const w1 = new Set(a.toLowerCase().split(/\s+/))
  const w2 = new Set(b.toLowerCase().split(/\s+/))
  const intersection = new Set([...w1].filter(w => w2.has(w)))
  const union = new Set([...w1, ...w2])
  return intersection.size / union.size
}

export async function POST(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id

  const body = await req.json()
  const { note_text, client_id, session_date } = body
  if (!client_id || !note_text) {
    return NextResponse.json({ error: 'Missing client_id or note_text' }, { status: 400 })
  }

  // Block exact duplicate before fuzzy check
  const exactMatch = await prisma.session_notes.findFirst({
    where: { client_id, note_text },
    select: { id: true },
  })
  if (exactMatch) {
    return NextResponse.json({ error: 'This note has already been saved.', duplicate: true }, { status: 409 })
  }

  // Similarity check against the last 10 notes for this client
  const prevNotes = await prisma.session_notes.findMany({
    where: { client_id },
    select: { note_text: true },
    orderBy: { created_at: 'desc' },
    take: 10,
  })

  for (const prev of prevNotes) {
    if (prev.note_text && calculateSimilarity(note_text, prev.note_text) >= 0.60) {
      return NextResponse.json({
        error: 'too_similar',
        message: 'Note is too similar to a previous session. Please vary your session details.',
      }, { status: 422 })
    }
  }

  const inserted = await prisma.session_notes.create({
    data: {
      client_id,
      user_id: userId,
      note_text,
      session_date: session_date || new Date().toISOString().split('T')[0],
      // Saved by the extension = the note pushed into the EHR for this session — the authoritative
      // "used" record, the strongest answer to "which note was used for this date".
      status: 'used',
    },
    select: { id: true },
  })

  return NextResponse.json({ success: true, id: inserted.id })
}
