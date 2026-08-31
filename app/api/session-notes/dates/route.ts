import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { canAccessClient } from '@/lib/clientFiles'
import { activeNotesWhere } from '@/lib/sessionNotes'

export const dynamic = 'force-dynamic'

// PHI-FREE. Distinct session dates that have an ACTIVE note for this client — the calendar's occupancy set
// (checked when the RBT picks a date; later the green-days source). Dates only: no text, no ids. Active-only,
// so it rides the partial index from migration 20260830000000.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  const rows = await prisma.session_notes.findMany({
    where: activeNotesWhere(clientId),
    select: { session_date: true },
    distinct: ['session_date'],
  })
  const dates = rows.map((r) => r.session_date).filter(Boolean).sort()
  return NextResponse.json({ dates })
}
