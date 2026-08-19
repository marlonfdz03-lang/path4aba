import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Missing name' }, { status: 400 })

  const client = await prisma.clients.findFirst({
    where: { id: clientId, rbt_id: user.id },
    select: { id: true, clinical_profile: true },
  })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const profile = (client.clinical_profile as any) || {}
  // whoWasPresent is the RBT's pill list for this client — the people they can MARK present.
  // `caregivers` is the assessment-derived roster and must NOT grow from a one-off attendee: a
  // substitute teacher present for a single session is not a caregiver of record. This used to
  // write into both, so anyone typed once became a permanent roster entry.
  const whoWasPresent = profile.whoWasPresent || []
  if (!whoWasPresent.includes(name)) whoWasPresent.push(name)

  await prisma.clients.update({
    where: { id: clientId },
    data: {
      clinical_profile: {
        ...profile,
        whoWasPresent,
      },
    },
  })

  return NextResponse.json({ ok: true, whoWasPresent, caregivers: profile.caregivers || [] })
}
