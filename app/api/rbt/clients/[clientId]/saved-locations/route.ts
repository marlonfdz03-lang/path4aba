import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

// Per-client saved "Other place of service" locations. Mirrors who-was-present exactly: a list on the
// client's clinical_profile that the RBT builds up over time, owner-checked by rbt_id, gated by the
// extension auth. Saving on client A never surfaces on client B. There is deliberately no separate
// mechanism — this is the same per-client pattern.
export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  const { location } = await req.json()
  const name = typeof location === 'string' ? location.trim() : ''
  if (!name) return NextResponse.json({ error: 'Missing location' }, { status: 400 })

  const client = await prisma.clients.findFirst({
    where: { id: clientId, rbt_id: user.id },
    select: { id: true, clinical_profile: true },
  })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const profile = (client.clinical_profile as any) || {}
  const savedLocations: string[] = Array.isArray(profile.savedLocations) ? profile.savedLocations : []
  if (!savedLocations.some((l) => l.toLowerCase() === name.toLowerCase())) savedLocations.push(name)

  await prisma.clients.update({
    where: { id: clientId },
    data: {
      clinical_profile: {
        ...profile,
        savedLocations,
      },
    },
  })

  return NextResponse.json({ ok: true, savedLocations })
}
