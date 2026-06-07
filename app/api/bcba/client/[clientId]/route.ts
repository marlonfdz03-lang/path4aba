import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id
  const { clientId } = await params


  const conn = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { rbt_id: true, connected_at: true },
  })

  if (!conn) return NextResponse.json({ error: 'Not connected to this client' }, { status: 403 })

  const clientRow = await prisma.clients.findUnique({
    where: { id: clientId },
    select: { id: true, internal_code: true, clinical_profile: true },
  })

  if (!clientRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  return NextResponse.json({
    client: {
      id: clientRow.id,
      internal_code: clientRow.internal_code,
      clinical_profile: clientRow.clinical_profile,
      client_name: (clientRow.clinical_profile as any)?.name || clientRow.internal_code || 'Unknown Client',
      rbt_id: conn.rbt_id,
      connected_at: conn.connected_at,
    },
  })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id
  const { clientId } = await params


  const conn = await prisma.bcba_clients.findFirst({
    where: { bcba_id: userId, client_id: clientId },
    select: { id: true },
  })

  if (!conn) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { clinicalProfile?: any }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clinicalProfile } = body
  if (!clinicalProfile || typeof clinicalProfile !== 'object') {
    return NextResponse.json({ error: 'Missing clinicalProfile' }, { status: 400 })
  }

  const existing = await prisma.clients.findUnique({
    where: { id: clientId },
    select: { clinical_profile: true },
  })
  const existingProfile = (existing?.clinical_profile as Record<string, any>) ?? {}
  const merged = { ...existingProfile, ...clinicalProfile }

  const updated = await prisma.clients.update({
    where: { id: clientId },
    data: { clinical_profile: merged },
    select: { id: true, internal_code: true, clinical_profile: true },
  })

  return NextResponse.json({
    client: {
      id: updated.id,
      internal_code: updated.internal_code,
      clinical_profile: updated.clinical_profile,
      client_name: (updated.clinical_profile as any)?.name || updated.internal_code || 'Unknown Client',
    },
  })
}
