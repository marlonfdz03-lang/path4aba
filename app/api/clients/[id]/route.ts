import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const client = await prisma.clients.findFirst({
      where: { id },
      select: { id: true, internal_code: true, clinical_profile: true },
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
  await prisma.clients.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
