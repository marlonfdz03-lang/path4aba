import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const notes = await prisma.session_notes.findMany({
    where: { client_id: clientId },
    select: { id: true, note_text: true, created_at: true, status: true },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json({ notes })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string
  const { clientId, noteText, sessionDate, behaviorsAddressed, skillsAddressed, interventionsUsed, activitiesUsed, generationContext } = await req.json()
  if (!clientId || !noteText) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Block duplicate: check if identical note already exists for this client
  const existing = await prisma.session_notes.findFirst({
    where: {
      client_id: clientId,
      note_text: noteText,
    },
    select: { id: true },
  })

  if (existing) {
    return NextResponse.json({ error: 'This note has already been saved.', duplicate: true }, { status: 409 })
  }

  await prisma.session_notes.create({
    data: {
      client_id: clientId,
      user_id: userId,
      note_text: noteText,
      session_date: sessionDate || new Date().toISOString().split('T')[0],
      behaviors_addressed: behaviorsAddressed || [],
      skills_addressed: skillsAddressed || [],
      interventions_used: interventionsUsed || [],
      // Persisted so the rotation/continuity reader learns from this note (Commit 4). activities_used was
      // never stored before; generation_context is exactly what the preselector chose. A note saved
      // without them (legacy client, other surface) contributes only the derivable axes — never wrong.
      activities_used: activitiesUsed || [],
      generation_context: generationContext ?? undefined,
      // Saved via the web note UI — authoritative unless a later 'used' row (EHR push) exists.
      status: 'saved',
    },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await prisma.session_notes.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
