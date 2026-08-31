import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'
import { canAccessClient } from '@/lib/clientFiles'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await canAccessClient(session, id)))
    return NextResponse.json({ error: 'Forbidden — you are not assigned to this client.' }, { status: 403 })

  try {
    const client = await prisma.clients.findFirst({
      where: { id },
      select: { id: true, internal_code: true, clinical_profile: true, treatment_map_approved: true },
    })

    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(client)
  } catch (err: any) {
    console.error('[GET /api/clients/:id] error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await canAccessClient(session, id)))
    return NextResponse.json({ error: 'Forbidden — you are not assigned to this client.' }, { status: 403 })

  const { clinical_profile } = await req.json()

  const existingRow = await prisma.clients.findUnique({
    where: { id },
    select: { clinical_profile: true },
  })
  const existingProfile = (existingRow?.clinical_profile as object) ?? {}
  const merged = { ...existingProfile, ...clinical_profile }

  await prisma.clients.update({ where: { id }, data: { clinical_profile: merged } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await canAccessClient(session, id)))
    return NextResponse.json({ error: 'Forbidden — you are not assigned to this client.' }, { status: 403 })

  // SOFT DELETE (archive), not a hard delete — see /api/clients DELETE. A hard delete cascade-destroyed the
  // client's billing records (session_notes, incl. superseded), PDFs, and data. Retain the row + children,
  // hidden from reads by the lib/prisma extension; restore via scripts/restore-client.ts.
  const userId = (session.user as any).id as string
  await prisma.clients.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: userId } })
  return NextResponse.json({ ok: true })
}
