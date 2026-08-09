import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'
import { userOwnsClient } from '@/lib/clientFiles'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

// PHI/ownership gate. A client's record (read, edit, delete) is accessible only to a user who OWNS it — its
// assigned RBT or a connected BCBA (userOwnsClient) — or an admin. Fails CLOSED: any other authenticated user
// is refused with 403 and no data is read or written. Without this, any logged-in user could read, overwrite,
// or delete ANY client's clinical_profile (PHI). Same hole-class already closed on the assessment route.
async function canAccessClient(session: any, clientId: string): Promise<boolean> {
  if ((session?.user as any)?.role === 'admin') return true
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return false
  return userOwnsClient(userId, clientId)
}


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

  await prisma.clients.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
