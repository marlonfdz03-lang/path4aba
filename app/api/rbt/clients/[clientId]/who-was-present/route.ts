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
  const whoWasPresent = profile.whoWasPresent || []
  const caregivers = profile.caregivers || []

  if (!whoWasPresent.includes(name)) whoWasPresent.push(name)
  if (!caregivers.includes(name)) caregivers.push(name)

  await prisma.clients.update({
    where: { id: clientId },
    data: {
      clinical_profile: {
        ...profile,
        whoWasPresent,
        caregivers,
      },
    },
  })

  return NextResponse.json({ ok: true, whoWasPresent, caregivers })
}
