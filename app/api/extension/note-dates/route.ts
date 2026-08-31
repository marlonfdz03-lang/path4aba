import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { principalCanAccessClient } from '@/lib/clientFiles'
import { prisma } from '@/lib/prisma'
import { activeNotesWhere } from '@/lib/sessionNotes'

export const dynamic = 'force-dynamic'

// Extension-auth'd (Bearer) twin of /api/session-notes/dates. PHI-FREE: distinct session dates that have an
// ACTIVE note for this client — the popup's occupancy set for the replace prompt. Dates only, no text/ids.
export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId') || url.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  const rows = await prisma.session_notes.findMany({
    where: activeNotesWhere(clientId),
    select: { session_date: true },
    distinct: ['session_date'],
  })
  const dates = rows.map((r) => r.session_date).filter(Boolean).sort()
  return NextResponse.json({ dates })
}
