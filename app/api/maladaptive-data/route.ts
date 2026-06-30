import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const where: any = { client_id: clientId }
  const behavior = searchParams.get('behavior')
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

export async function DELETE(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id           = searchParams.get('id')
  const clientId     = searchParams.get('clientId')
  const behaviorName = searchParams.get('behaviorName')
  const weekStart    = searchParams.get('weekStart')

  try {
    if (id) {
      await prisma.maladaptive_data.delete({ where: { id } })
      return NextResponse.json({ ok: true, deleted: 1 })
    }
    if (!clientId) return NextResponse.json({ error: 'clientId or id required' }, { status: 400 })

    const where: any = { client_id: clientId }
    if (behaviorName) where.behavior_name = { contains: behaviorName, mode: 'insensitive' }
    if (weekStart)    where.week_start    = weekStart

    const result = await prisma.maladaptive_data.deleteMany({ where })
    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = await req.json()
  const now = new Date()

  try {
    const data: any = { updated_at: now }
    if (body.frequency != null)            data.frequency             = body.frequency
    if (body.isAnomaly != null)            data.is_anomaly            = body.isAnomaly
    if (body.anomalyReviewed != null)      data.anomaly_reviewed      = body.anomalyReviewed
    if (body.anomalyJustification != null) data.anomaly_justification = body.anomalyJustification
    if (body.originalValue != null)        data.original_value        = body.originalValue

    const updated = await prisma.maladaptive_data.update({ where: { id }, data })
    return NextResponse.json({ ok: true, data: updated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const records: any[] = Array.isArray(body) ? body : [body]
  const now = new Date()

  try {
    const results = await Promise.all(
      records.map(async (r) => {
        // Upsert: if a record for the same client+behavior+week already exists, update it.
        const existing = r.weekStart
          ? await prisma.maladaptive_data.findFirst({
              where: {
                client_id:     r.clientId,
                behavior_name: r.behaviorName,
                week_start:    r.weekStart,
              },
              select: { id: true },
            })
          : null

        if (existing) {
          return prisma.maladaptive_data.update({
            where: { id: existing.id },
            data: {
              frequency:       r.frequency      ?? null,
              rate:            r.rate           ?? null,
              duration:        r.duration       ?? null,
              daily_values:    r.dailyValues    ?? null,
              user_confirmed:  r.userConfirmed  ?? false,
              confirmed_at:    r.userConfirmed  ? now : null,
              projected_value: r.projectedValue ?? null,
              goal_met:        r.goalMet        ?? null,
              updated_at:      now,
            },
          })
        }

        return prisma.maladaptive_data.create({
          data: {
            client_id:       r.clientId,
            behavior_name:   r.behaviorName,
            week_start:      r.weekStart      ?? null,
            week_end:        r.weekEnd        ?? null,
            session_date:    r.sessionDate    ?? null,
            frequency:       r.frequency      ?? null,
            rate:            r.rate           ?? null,
            duration:        r.duration       ?? null,
            trials:          r.trials         ?? null,
            daily_values:    r.dailyValues    ?? null,
            user_confirmed:  r.userConfirmed  ?? false,
            confirmed_at:    r.userConfirmed  ? now : null,
            projected_value: r.projectedValue ?? null,
            goal_met:        r.goalMet        ?? null,
          },
        })
      })
    )
    return NextResponse.json({ ok: true, count: results.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
