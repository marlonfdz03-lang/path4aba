import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const notes = await prisma.session_notes.findMany({
    where: { client_id: clientId },
    select: { id: true, note_text: true, created_at: true },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json({ notes })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string
  const { clientId, noteText, sessionDate } = await req.json()
  if (!clientId || !noteText) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  await prisma.session_notes.create({
    data: {
      client_id: clientId,
      user_id: userId,
      note_text: noteText,
      session_date: sessionDate || new Date().toISOString().split('T')[0],
    },
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await prisma.session_notes.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
