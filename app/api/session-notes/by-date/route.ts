import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { canAccessClient } from '@/lib/clientFiles'
import { activeNotesWhere } from '@/lib/sessionNotes'

export const dynamic = 'force-dynamic'

// Returns the ACTIVE note's TEXT for one date — PHI, so called only when the RBT clicks "View" in the replace
// prompt (never on picker open — that uses the PHI-free /dates endpoint). Latest created_at wins if more than
// one active row ever coexisted for a date (defensive tiebreak; the replace flow keeps it at one).
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const date = url.searchParams.get('date')
  if (!clientId || !date) return NextResponse.json({ error: 'Missing clientId or date' }, { status: 400 })
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  const note = await prisma.session_notes.findFirst({
    where: activeNotesWhere(clientId, date),
    select: { id: true, note_text: true, created_at: true },
    orderBy: { created_at: 'desc' },
  })
  return NextResponse.json({ note: note ? { id: note.id, text: note.note_text, createdAt: note.created_at } : null })
}
