import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { canAccessClient } from '@/lib/clientFiles'
import { filterBlockedNarrative } from '@/lib/blockedNarrativeTerms'
import { buildBlockedFilterContext } from '@/lib/noteFilterContext'
import { emitAdminAlert } from '@/lib/adminAlerts'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

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
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

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

  // SERVER-SIDE BACKSTOP (symmetry with extension/save-note). The web client already swaps in the filtered
  // text before posting, so this is normally a no-op — but if that swap is ever bypassed or regresses, we
  // still store a clean record. Same shared filter inputs; fail-soft, never blocks the save.
  let cleanText = noteText
  try {
    const { learnedBlockedTerms, authorizedNames } = await buildBlockedFilterContext(clientId)
    const filtered = filterBlockedNarrative(noteText, learnedBlockedTerms, authorizedNames)
    if (filtered.text !== noteText) {
      cleanText = filtered.text
      await emitAdminAlert({
        source: 'note',
        type: 'note.save_filter_caught',
        severity: 'warning',
        actorUserId: userId,
        clientId,
        payload: { surface: 'web', substituted: filtered.substituted, flagged: filtered.flagged },
      })
    }
  } catch { /* fail-soft: store what we have rather than blocking the save */ }

  await prisma.session_notes.create({
    data: {
      client_id: clientId,
      user_id: userId,
      note_text: cleanText,
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

  // Resolve the note's owning client from its row id, then enforce ownership before deleting. A row whose
  // client_id is NULL is owned by nobody → DENY (never mutable by anyone). Missing row → 403, not 404 (leak
  // nothing about which ids exist).
  const row = await prisma.session_notes.findUnique({ where: { id }, select: { client_id: true } })
  if (!row?.client_id || !(await canAccessClient(session, row.client_id)))
    return NextResponse.json({ error: 'You do not have access to this note.' }, { status: 403 })

  await prisma.session_notes.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
