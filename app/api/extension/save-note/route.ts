import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { principalCanAccessClient } from '@/lib/clientFiles'
import { prisma } from '@/lib/prisma'
import { filterBlockedNarrative } from '@/lib/blockedNarrativeTerms'
import { buildBlockedFilterContext } from '@/lib/noteFilterContext'
import { emitAdminAlert } from '@/lib/adminAlerts'
import { activeNotesWhere, supersedeAndCreate } from '@/lib/sessionNotes'

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
  const { note_text, client_id, session_date, supersede, id } = body
  if (!client_id || !note_text) {
    return NextResponse.json({ error: 'Missing client_id or note_text' }, { status: 400 })
  }
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, client_id)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  // REPLACE an existing date's note (calendar replace flow). Supersede-and-create, atomic and idempotent on the
  // client-generated id; skips BOTH the exact-dup and similarity gates (the RBT explicitly chose to replace, and
  // those create-time gates would otherwise trip the note against the note it is replacing). Filter first.
  if (supersede && id) {
    let cleanReplaceText = note_text
    try {
      const { learnedBlockedTerms, authorizedNames } = await buildBlockedFilterContext(client_id)
      const filtered = filterBlockedNarrative(note_text, learnedBlockedTerms, authorizedNames)
      if (filtered.text !== note_text) {
        cleanReplaceText = filtered.text
        await emitAdminAlert({
          source: 'extension', type: 'note.save_filter_caught', severity: 'warning',
          actorUserId: userId, clientId: client_id,
          payload: { surface: 'extension', substituted: filtered.substituted, flagged: filtered.flagged },
        })
      }
    } catch { /* fail-soft */ }
    const res = await supersedeAndCreate({
      id, clientId: client_id, sessionDate: session_date || new Date().toISOString().split('T')[0],
      userId, noteText: cleanReplaceText,
    })
    return NextResponse.json({ success: true, id: res.id })
  }

  // Block exact duplicate before fuzzy check — against ACTIVE notes only (a superseded/replaced note must never
  // block a legitimate new save).
  const exactMatch = await prisma.session_notes.findFirst({
    where: { ...activeNotesWhere(client_id), note_text },
    select: { id: true },
  })
  if (exactMatch) {
    // Return the id so the client ADOPTS this row (upsert-per-cycle) and shows "Saved ✓" — edits then PATCH it.
    return NextResponse.json({ error: 'This note has already been saved.', duplicate: true, id: exactMatch.id }, { status: 409 })
  }

  // Similarity check against the last 10 ACTIVE notes for this client
  const prevNotes = await prisma.session_notes.findMany({
    where: activeNotesWhere(client_id),
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

  // SERVER-SIDE BACKSTOP: the extension can leave RAW, unfiltered text in outputNote when the __META__ tail
  // splits across network reads, so the note posted here may still contain a blocked term. Re-run the SAME
  // filter (shared authorizedNames + learned terms — never a divergent second copy) so our stored record is
  // clean regardless of the client. Fail-soft: never let the backstop block a save.
  let cleanText = note_text
  try {
    const { learnedBlockedTerms, authorizedNames } = await buildBlockedFilterContext(client_id)
    const filtered = filterBlockedNarrative(note_text, learnedBlockedTerms, authorizedNames)
    if (filtered.text !== note_text) {
      cleanText = filtered.text
      // The client shipped a blocked term it should have filtered → record which terms fired (names only,
      // never note text) so we can see the extension leak is still live and, later, that the release fixed it.
      await emitAdminAlert({
        source: 'extension',
        type: 'note.save_filter_caught',
        severity: 'warning',
        actorUserId: userId,
        clientId: client_id,
        payload: { surface: 'extension', substituted: filtered.substituted, flagged: filtered.flagged },
      })
    }
  } catch { /* fail-soft: store what we have rather than blocking the save */ }

  const inserted = await prisma.session_notes.create({
    data: {
      client_id,
      user_id: userId,
      note_text: cleanText,
      session_date: session_date || new Date().toISOString().split('T')[0],
      // 'saved' (kept), NOT 'used'. Autosave now creates this row at GENERATION — before any EHR push, and for
      // notes that may be abandoned via Start-new — so 'used' (per the schema: "pushed into the EHR by the
      // extension") would over-claim. Nothing reads status === 'used' today; a precise 'used'-on-EHR-fill
      // marker is a separate follow-up. Matches the web create path.
      status: 'saved',
    },
    select: { id: true },
  })

  return NextResponse.json({ success: true, id: inserted.id })
}

// PATCH /api/extension/save-note — UPDATE one existing note in place (the upsert-per-cycle path: autosave
// creates once via POST, then re-generations and debounced/blur/teardown edits update THAT row by id).
// Update-only — it never creates. DELIBERATELY skips the similarity and exact-duplicate checks: those are
// create-time admission gates, and re-running them on an update would compare the row to its OWN prior stored
// version and 422 the note against itself. Same blocked-narrative backstop as POST.
export async function PATCH(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = user.id

  const body = await req.json()
  const { id, client_id, note_text, session_date } = body
  if (!id || !client_id || !note_text) {
    return NextResponse.json({ error: 'Missing id, client_id or note_text' }, { status: 400 })
  }
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, client_id)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  // Same fail-soft blocked-narrative backstop as POST (create and update must store clean text identically).
  let cleanText = note_text
  try {
    const { learnedBlockedTerms, authorizedNames } = await buildBlockedFilterContext(client_id)
    const filtered = filterBlockedNarrative(note_text, learnedBlockedTerms, authorizedNames)
    if (filtered.text !== note_text) {
      cleanText = filtered.text
      await emitAdminAlert({
        source: 'extension',
        type: 'note.save_filter_caught',
        severity: 'warning',
        actorUserId: userId,
        clientId: client_id,
        payload: { surface: 'extension', substituted: filtered.substituted, flagged: filtered.flagged },
      })
    }
  } catch { /* fail-soft: store what we have rather than blocking the save */ }

  // UPDATE-ONLY, ownership-SCOPED. updateMany over { id, client_id } updates the row IFF it exists AND belongs
  // to this caller-owned client. A stale id (deleted) or another client's id matches ZERO rows — never a stray
  // create, never a cross-client write; the client re-creates on the { recreate: true } signal. status is left
  // untouched.
  const data: any = { note_text: cleanText }
  if (session_date) data.session_date = session_date
  const { count } = await prisma.session_notes.updateMany({ where: { id, client_id }, data })

  if (count === 0) {
    return NextResponse.json({ error: 'This note no longer exists — save it as a new note.', recreate: true }, { status: 404 })
  }

  return NextResponse.json({ success: true, id })
}
