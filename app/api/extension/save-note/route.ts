import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { principalCanAccessClient } from '@/lib/clientFiles'
import { prisma } from '@/lib/prisma'
import { filterBlockedNarrative } from '@/lib/blockedNarrativeTerms'
import { buildBlockedFilterContext } from '@/lib/noteFilterContext'
import { emitAdminAlert } from '@/lib/adminAlerts'

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
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, client_id)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

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
      // Saved by the extension = the note pushed into the EHR for this session — the authoritative
      // "used" record, the strongest answer to "which note was used for this date".
      status: 'used',
    },
    select: { id: true },
  })

  return NextResponse.json({ success: true, id: inserted.id })
}
