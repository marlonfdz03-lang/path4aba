import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string
  const isUuid = UUID_RE.test(userId)

  const orConditions: any[] = [{ created_by: null }]
  if (isUuid) {
    orConditions.push({ rbt_id: userId })
    orConditions.push({ created_by: userId })
  }

  const clients = await prisma.clients.findMany({
    where: { OR: orConditions },
    select: { id: true, internal_code: true, clinical_profile: true, created_at: true },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json(clients)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string
  const isUuid = UUID_RE.test(userId)

  const body = await req.json()
  const { id, clientName, clinicalProfile } = body
  if (!id || !clientName) return NextResponse.json({ error: 'Missing id or clientName' }, { status: 400 })

  await prisma.clients.upsert({
    where: { id },
    create: {
      id,
      internal_code: id,
      created_by: isUuid ? userId : null,
      rbt_id: isUuid ? userId : null,
      clinical_profile: { name: clientName, ...clinicalProfile },
    },
    update: {
      clinical_profile: { name: clientName, ...clinicalProfile },
    },
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await prisma.clients.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
