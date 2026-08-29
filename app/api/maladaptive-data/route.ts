import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { principalCanAccessClient, principalCanAccessRow } from '@/lib/clientFiles'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'
import { canonicalName } from '@/lib/nameMatch'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

// CONSOLIDATION tier: fold an incoming name onto an already-stored one so all data lands
// on one series. `shared2` (exact / substring / >= 2 shared words) is the tier this route
// has always used — see lib/nameMatch.ts for why the tiers are named rather than re-derived.
const CONSOLIDATION_TIER = 'shared2' as const

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

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

  const principal = { id: user.id, role: user.role }
  try {
    if (id) {
      // Resolve the row's owning client from its id; deny on missing row / null client_id / non-ownership.
      if (!(await principalCanAccessRow(principal, (rid) =>
        prisma.maladaptive_data.findUnique({ where: { id: rid }, select: { client_id: true } }), id)))
        return NextResponse.json({ error: 'You do not have access to this row.' }, { status: 403 })
      await prisma.maladaptive_data.delete({ where: { id } })
      return NextResponse.json({ ok: true, deleted: 1 })
    }
    if (!clientId) return NextResponse.json({ error: 'clientId or id required' }, { status: 400 })
    if (!(await principalCanAccessClient(principal, clientId)))
      return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

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
  if (!(await principalCanAccessRow({ id: user.id, role: user.role }, (rid) =>
    prisma.maladaptive_data.findUnique({ where: { id: rid }, select: { client_id: true } }), id)))
    return NextResponse.json({ error: 'You do not have access to this row.' }, { status: 403 })

  const body = await req.json()
  const now = new Date()

  try {
    const data: any = { updated_at: now }
    if (body.frequency != null)            data.frequency             = body.frequency
    if (body.isAnomaly != null)            data.is_anomaly            = body.isAnomaly
    if (body.anomalyReviewed != null)      data.anomaly_reviewed      = body.anomalyReviewed
    if (body.anomalyJustification != null) data.anomaly_justification = body.anomalyJustification
    if (body.originalValue != null)        data.original_value        = body.originalValue
    // autofill_completed was settable through neither POST nor PATCH here, so only the
    // corrections flow could ever write it — replacement-data has accepted it since it was
    // added. valueOrigin travels with it: an RBT fixing a value makes that value theirs.
    if (body.autofillCompleted != null)    data.autofill_completed    = body.autofillCompleted
    if (body.valueOrigin != null)          data.value_origin          = body.valueOrigin

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

  // OWNERSHIP over the WHOLE batch, before any write. Every record must carry a clientId (a missing one
  // would create a nobody-owned row), and the caller must own EVERY distinct client in the batch. Deny the
  // entire request if any check fails — never partially write.
  const principal = { id: user.id, role: user.role }
  if (records.some((r) => !r?.clientId))
    return NextResponse.json({ error: 'Every record must include a clientId.' }, { status: 400 })
  const batchClientIds = [...new Set(records.map((r) => r.clientId))]
  const ownership = await Promise.all(batchClientIds.map((cid) => principalCanAccessClient(principal, cid)))
  if (ownership.some((ok) => !ok))
    return NextResponse.json({ error: 'You do not have access to one or more clients in this batch.' }, { status: 403 })

  try {
    // Pre-fetch the distinct behavior names already stored for each client in
    // this batch, so an incoming name that fuzzy-matches an existing series
    // consolidates under the canonical (already-stored) name instead of
    // creating a duplicate series.
    const clientIds = [...new Set(records.map((r) => r.clientId).filter(Boolean))]
    const namesByClient = new Map<string, string[]>()
    await Promise.all(
      clientIds.map(async (cid) => {
        const existing = await prisma.maladaptive_data.findMany({
          where: { client_id: cid },
          select: { behavior_name: true },
          distinct: ['behavior_name'],
        })
        namesByClient.set(cid, existing.map((e) => e.behavior_name))
      })
    )

    const results = await Promise.all(
      records.map(async (r) => {
        const behaviorName = canonicalName(r.behaviorName, namesByClient.get(r.clientId) ?? [], CONSOLIDATION_TIER)

        // Upsert: if a record for the same client+behavior+week already exists, update it.
        const existing = r.weekStart
          ? await prisma.maladaptive_data.findFirst({
              where: {
                client_id:     r.clientId,
                behavior_name: behaviorName,
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
              value_origin:    r.valueOrigin    ?? null,
              autofill_completed: r.autofillCompleted ?? false,
              updated_at:      now,
            },
          })
        }

        return prisma.maladaptive_data.create({
          data: {
            client_id:       r.clientId,
            behavior_name:   behaviorName,
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
            // Provenance of the number. NULL is reserved for legacy rows written before the
            // column existed — every new row states where its value came from.
            value_origin:    r.valueOrigin    ?? null,
            autofill_completed: r.autofillCompleted ?? false,
          },
        })
      })
    )
    return NextResponse.json({ ok: true, count: results.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
