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

  const where: any = { client_id: clientId }
  const dateFrom = searchParams.get('dateFrom')
  const dateTo   = searchParams.get('dateTo')
  const behavior = searchParams.get('behavior')
  if (dateFrom) where.week_start = { ...(where.week_start ?? {}), gte: dateFrom }
  if (dateTo)   where.week_start = { ...(where.week_start ?? {}), lte: dateTo }
  if (behavior) where.behavior_name = { contains: behavior, mode: 'insensitive' }

  try {
    const data = await prisma.maladaptive_data.findMany({
      where,
      orderBy: [{ week_start: 'desc' }, { created_at: 'desc' }],
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
        prisma.maladaptive_data.create({
          data: {
            client_id: r.clientId,
            behavior_name: r.behaviorName,
            week_start: r.weekStart ?? null,
            week_end: r.weekEnd ?? null,
            session_date: r.sessionDate ?? null,
            frequency: r.frequency ?? null,
            rate: r.rate ?? null,
            duration: r.duration ?? null,
            trials: r.trials ?? null,
            daily_values: r.dailyValues ?? null,
            user_confirmed: r.userConfirmed ?? false,
            confirmed_at: r.userConfirmed ? now : null,
            projected_value: r.projectedValue ?? null,
            goal_met: r.goalMet ?? null,
          },
        })
      )
    )
    return NextResponse.json({ ok: true, count: created.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
