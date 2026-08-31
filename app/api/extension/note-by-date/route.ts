import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { principalCanAccessClient } from '@/lib/clientFiles'
import { prisma } from '@/lib/prisma'
import { activeNotesWhere } from '@/lib/sessionNotes'

export const dynamic = 'force-dynamic'

// Extension-auth'd (Bearer) twin of /api/session-notes/by-date. Returns the ACTIVE note's TEXT for one date —
// PHI, so called only when the RBT clicks "View" in the popup's replace prompt (never on picker open). Latest
// created_at wins if more than one active row ever coexisted for a date (defensive tiebreak).
export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId') || url.searchParams.get('client_id')
  const date = url.searchParams.get('date')
  if (!clientId || !date) return NextResponse.json({ error: 'Missing clientId or date' }, { status: 400 })
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  const note = await prisma.session_notes.findFirst({
    where: activeNotesWhere(clientId, date),
    select: { id: true, note_text: true, created_at: true },
    orderBy: { created_at: 'desc' },
  })
  return NextResponse.json({ note: note ? { id: note.id, text: note.note_text, createdAt: note.created_at } : null })
}
