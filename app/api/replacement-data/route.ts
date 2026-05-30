import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const dateFrom = searchParams.get('dateFrom') || undefined
  const dateTo = searchParams.get('dateTo') || undefined
  const skill = searchParams.get('skill') || undefined
  const location = searchParams.get('location') || undefined

  const where: any = { client_id: clientId }
  if (dateFrom || dateTo) {
    where.session_date = {}
    if (dateFrom) where.session_date.gte = dateFrom
    if (dateTo) where.session_date.lte = dateTo
  }
  if (skill) where.replacement_skill = { contains: skill, mode: 'insensitive' }
  if (location) where.location = location

  try {
    const data = await prisma.replacement_data.findMany({
      where,
      orderBy: [{ session_date: 'desc' }, { created_at: 'desc' }],
    })
    return NextResponse.json({ data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const records: any[] = Array.isArray(body) ? body : [body]

  const now = new Date()
  try {
    const created = await Promise.all(
      records.map((r) =>
        prisma.replacement_data.create({
          data: {
            client_id: r.clientId,
            session_date: r.sessionDate ?? null,
            location: r.location ?? null,
            session_time_in: r.sessionTimeIn ?? null,
            session_time_out: r.sessionTimeOut ?? null,
            rbt_name: r.rbtName ?? null,
            platform_source: r.platformSource ?? null,
            replacement_skill: r.replacementSkill,
            total_trials: r.totalTrials,
            observed_percentage: r.observedPercentage,
            correct_count: r.correctCount,
            incorrect_count: r.incorrectCount,
            alternated_sequence: r.alternatedSequence ?? null,
            user_confirmed: r.userConfirmed ?? false,
            confirmed_at: r.userConfirmed ? now : null,
            autofill_completed: r.autofillCompleted ?? false,
          },
        })
      )
    )
    return NextResponse.json({ ok: true, count: created.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
