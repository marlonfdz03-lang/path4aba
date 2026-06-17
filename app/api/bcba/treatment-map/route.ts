import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
  })
  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.clients.findUnique({
    where: { id: clientId },
    select: { clinical_profile: true, treatment_map_approved: true, treatment_map_data: true }
  })

  return NextResponse.json({
    clinicalProfile: client?.clinical_profile,
    treatmentMapApproved: client?.treatment_map_approved,
    treatmentMapData: client?.treatment_map_data,
  })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { clientId, treatmentMapData, treatmentMapApproved } = await req.json()
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const connection = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
  })
  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const updateData: Record<string, unknown> = {}
  if (treatmentMapData !== undefined) updateData.treatment_map_data = treatmentMapData
  if (treatmentMapApproved !== undefined) updateData.treatment_map_approved = treatmentMapApproved

  await prisma.clients.update({
    where: { id: clientId },
    data: updateData,
  })

  return NextResponse.json({ ok: true })
}
