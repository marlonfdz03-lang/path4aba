import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { canAccessClient } from '@/lib/clientFiles'
import { filterBlockedNarrative } from '@/lib/blockedNarrativeTerms'
import { buildBlockedFilterContext } from '@/lib/noteFilterContext'
import { emitAdminAlert } from '@/lib/adminAlerts'
import { activeNotesWhere, supersedeAndCreate } from '@/lib/sessionNotes'

export const dynamic = 'force-dynamic'

// Shared server-side blocked-narrative backstop for BOTH create (POST) and update (PATCH). The web client
// swaps in the filtered text before sending, so this is normally a no-op — but if that swap is ever bypassed
// or regresses, we still store a clean record on either path (create and update must filter identically).
// Fail-soft: never throws, never blocks the save; on any failure we store what we were given.
async function filterNoteForSave(clientId: string, userId: string, noteText: string): Promise<string> {
  try {
    const { learnedBlockedTerms, authorizedNames } = await buildBlockedFilterContext(clientId)
    const filtered = filterBlockedNarrative(noteText, learnedBlockedTerms, authorizedNames)
    if (filtered.text !== noteText) {
      await emitAdminAlert({
        source: 'note',
        type: 'note.save_filter_caught',
        severity: 'warning',
        actorUserId: userId,
        clientId,
        payload: { surface: 'web', substituted: filtered.substituted, flagged: filtered.flagged },
      })
      return filtered.text
    }
  } catch { /* fail-soft: store what we have rather than blocking the save */ }
  return noteText
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  const notes = await prisma.session_notes.findMany({
    where: activeNotesWhere(clientId),  // active only — superseded (replaced) notes never appear in the list
    select: { id: true, note_text: true, created_at: true, status: true },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json({ notes })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string
  const { clientId, noteText, sessionDate, behaviorsAddressed, skillsAddressed, interventionsUsed, activitiesUsed, generationContext, supersede, id } = await req.json()
  if (!clientId || !noteText) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  // REPLACE an existing date's note (the calendar's replace flow). Supersede-and-create, atomic and idempotent
  // on the client-generated id; skips the exact-dup 409 (the RBT explicitly chose to replace). Same clean-text
  // backstop as the plain create.
  if (supersede && id) {
    const cleanText = await filterNoteForSave(clientId, userId, noteText)
    const res = await supersedeAndCreate({
      id, clientId, sessionDate: sessionDate || new Date().toISOString().split('T')[0], userId,
      noteText: cleanText, behaviorsAddressed, skillsAddressed, interventionsUsed, activitiesUsed,
      generationContext,
    })
    return NextResponse.json({ ok: true, id: res.id })
  }

  // Block duplicate: check if an identical ACTIVE note already exists for this client (a superseded/replaced
  // note must never 409-block a legitimate new save).
  const existing = await prisma.session_notes.findFirst({
    where: { ...activeNotesWhere(clientId), note_text: noteText },
    select: { id: true },
  })

  if (existing) {
    // Return the existing note's id so the client ADOPTS it (upsert-per-cycle) — subsequent edits PATCH this
    // row and the RBT sees "Saved ✓", not a duplicate error for something already safely stored.
    return NextResponse.json({ error: 'This note has already been saved.', duplicate: true, id: existing.id }, { status: 409 })
  }

  // SERVER-SIDE BACKSTOP (symmetry with extension/save-note + the PATCH path). Normally a no-op; see helper.
  const cleanText = await filterNoteForSave(clientId, userId, noteText)

  const created = await prisma.session_notes.create({
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
  return NextResponse.json({ ok: true, id: created.id })
}

// PATCH /api/session-notes — UPDATE one existing note in place (the upsert-per-cycle path: autosave creates
// once via POST, then re-generations and debounced edits update THAT row by id). Update-only — it never
// creates. Body: { id, clientId, noteText, sessionDate?, behaviorsAddressed?, skillsAddressed?,
// interventionsUsed?, activitiesUsed?, generationContext? }.
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string
  const { id, clientId, noteText, sessionDate, behaviorsAddressed, skillsAddressed, interventionsUsed, activitiesUsed, generationContext } = await req.json()
  if (!id || !clientId || !noteText) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  const cleanText = await filterNoteForSave(clientId, userId, noteText)

  // note_text is always rewritten; each metadata field is written ONLY when the caller sent it, so a plain
  // edit ({ id, clientId, noteText }) never clobbers metadata a prior re-generation stored.
  const data: any = { note_text: cleanText }
  if (sessionDate !== undefined) data.session_date = sessionDate
  if (behaviorsAddressed !== undefined) data.behaviors_addressed = behaviorsAddressed
  if (skillsAddressed !== undefined) data.skills_addressed = skillsAddressed
  if (interventionsUsed !== undefined) data.interventions_used = interventionsUsed
  if (activitiesUsed !== undefined) data.activities_used = activitiesUsed
  if (generationContext !== undefined) data.generation_context = generationContext

  // UPDATE-ONLY, ownership-SCOPED. updateMany over { id, client_id: clientId } (clientId already
  // canAccessClient-gated above) updates the row IFF it exists AND belongs to this caller-owned client. A
  // stale id (note deleted) OR an id owned by another client matches ZERO rows — never a stray create, never
  // a cross-client write. Both cases return the SAME response, so nothing about which ids exist elsewhere
  // leaks (consistent with DELETE's anti-enumeration stance).
  const { count } = await prisma.session_notes.updateMany({ where: { id, client_id: clientId }, data })

  if (count === 0) {
    // The tracked id no longer resolves to one of this client's notes. Do NOT create here — signal the client
    // to fall back to POST (create), which returns a fresh id. Explicit (never silent); no row was written.
    return NextResponse.json({ error: 'This note no longer exists — save it as a new note.', recreate: true }, { status: 404 })
  }

  return NextResponse.json({ ok: true, id })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Resolve the note's owning client from its row id, then enforce ownership before deleting. A row whose
  // client_id is NULL is owned by nobody → DENY (never mutable by anyone). Missing row → 403, not 404 (leak
  // nothing about which ids exist). NOT active-filtered on purpose: this is a by-id ownership lookup for a
  // write (delete), not a corpus read — a superseded note is still a deletable row; do not add superseded_at here.
  const row = await prisma.session_notes.findUnique({ where: { id }, select: { client_id: true } })
  if (!row?.client_id || !(await canAccessClient(session, row.client_id)))
    return NextResponse.json({ error: 'You do not have access to this note.' }, { status: 403 })

  // SOFT-DELETE, not destroy. A note is a CPT-97153 billing record — the old prisma.session_notes.delete
  // dropped the row permanently, with no server trace (admin_alerts stores no id/text). Mark it instead: it
  // leaves every active-note reader (they all filter deleted_at via activeNotesWhere) and is recoverable via
  // scripts/restore-note.ts. This is the delete-path twin of the note supersede + the client archive.
  const deletedBy = (session.user as any)?.id ?? session.user?.email ?? null
  await prisma.session_notes.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: deletedBy } })
  return NextResponse.json({ ok: true })
}
