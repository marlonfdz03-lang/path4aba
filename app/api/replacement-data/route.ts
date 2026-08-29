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

// CONSOLIDATION tier — identical to the maladaptive route. See lib/nameMatch.ts.
const CONSOLIDATION_TIER = 'shared2' as const

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  const skill = searchParams.get('skill') || undefined
  const location = searchParams.get('location') || undefined

  const where: any = { client_id: clientId }
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

export async function DELETE(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id             = searchParams.get('id')
  const clientId       = searchParams.get('clientId')
  const replacementSkill = searchParams.get('replacementSkill')
  const weekStart      = searchParams.get('weekStart')
  const sessionDate    = searchParams.get('sessionDate')

  const principal = { id: user.id, role: user.role }
  try {
    if (id) {
      // Resolve the row's owning client from its id; deny on missing row / null client_id / non-ownership.
      if (!(await principalCanAccessRow(principal, (rid) =>
        prisma.replacement_data.findUnique({ where: { id: rid }, select: { client_id: true } }), id)))
        return NextResponse.json({ error: 'You do not have access to this row.' }, { status: 403 })
      await prisma.replacement_data.delete({ where: { id } })
      return NextResponse.json({ ok: true, deleted: 1 })
    }
    if (!clientId) return NextResponse.json({ error: 'clientId or id required' }, { status: 400 })
    if (!(await principalCanAccessClient(principal, clientId)))
      return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

    const where: any = { client_id: clientId }
    if (replacementSkill) where.replacement_skill = { contains: replacementSkill, mode: 'insensitive' }
    if (weekStart)        where.week_start         = weekStart
    if (sessionDate)      where.session_date        = sessionDate

    const result = await prisma.replacement_data.deleteMany({ where })
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
    prisma.replacement_data.findUnique({ where: { id: rid }, select: { client_id: true } }), id)))
    return NextResponse.json({ error: 'You do not have access to this row.' }, { status: 403 })

  const body = await req.json()
  const now = new Date()

  try {
    const data: any = { updated_at: now }
    if (body.observedPercentage != null) data.observed_percentage = body.observedPercentage
    if (body.isAnomaly != null)            data.is_anomaly            = body.isAnomaly
    if (body.anomalyReviewed != null)      data.anomaly_reviewed      = body.anomalyReviewed
    if (body.anomalyJustification != null) data.anomaly_justification = body.anomalyJustification
    if (body.originalValue != null)        data.original_value        = body.originalValue
    if (body.autofillCompleted != null)    data.autofill_completed    = body.autofillCompleted
    if (body.valueOrigin != null)          data.value_origin          = body.valueOrigin

    const updated = await prisma.replacement_data.update({ where: { id }, data })
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
    // Pre-fetch the distinct skill names already stored for each client in this
    // batch, so an incoming name that fuzzy-matches an existing series
    // consolidates under the canonical (already-stored) name instead of
    // creating a duplicate series.
    const clientIds = [...new Set(records.map((r) => r.clientId).filter(Boolean))]
    const namesByClient = new Map<string, string[]>()
    await Promise.all(
      clientIds.map(async (cid) => {
        const existing = await prisma.replacement_data.findMany({
          where: { client_id: cid },
          select: { replacement_skill: true },
          distinct: ['replacement_skill'],
        })
        namesByClient.set(cid, existing.map((e) => e.replacement_skill))
      })
    )

    const results = await Promise.all(
      records.map(async (r) => {
        const replacementSkill = canonicalName(r.replacementSkill, namesByClient.get(r.clientId) ?? [], CONSOLIDATION_TIER)

        // Upsert: if a record for the same client+skill+week already exists, update it.
        const existing = r.weekStart
          ? await prisma.replacement_data.findFirst({
              where: {
                client_id:         r.clientId,
                replacement_skill: replacementSkill,
                week_start:        r.weekStart,
              },
              select: { id: true },
            })
          : null

        if (existing) {
          return prisma.replacement_data.update({
            where: { id: existing.id },
            data: {
              observed_percentage: r.observedPercentage ?? r.dailyPercentage ?? 0,
              total_trials:        r.totalTrials ?? r.trials ?? 10,
              correct_count:       r.correctCount     ?? 0,
              incorrect_count:     r.incorrectCount   ?? 0,
              alternated_sequence: r.alternatedSequence ?? r.sequence ?? null,
              user_confirmed:      r.userConfirmed    ?? false,
              confirmed_at:        r.userConfirmed    ? now : null,
              autofill_completed:  r.autofillCompleted ?? false,
              value_origin:        r.valueOrigin       ?? null,
              updated_at:          now,
            },
          })
        }

        return prisma.replacement_data.create({
          data: {
            client_id:           r.clientId,
            session_date:        r.sessionDate        ?? null,
            week_start:          r.weekStart          ?? null,
            week_end:            r.weekEnd            ?? null,
            location:            r.location           ?? null,
            session_time_in:     r.sessionTimeIn      ?? null,
            session_time_out:    r.sessionTimeOut     ?? null,
            rbt_name:            r.rbtName            ?? null,
            platform_source:     r.platformSource     ?? null,
            replacement_skill:   replacementSkill,
            total_trials:        r.totalTrials ?? r.trials ?? 10,
            observed_percentage: r.observedPercentage ?? r.dailyPercentage ?? 0,
            correct_count:       r.correctCount       ?? 0,
            incorrect_count:     r.incorrectCount     ?? 0,
            alternated_sequence: r.alternatedSequence ?? r.sequence ?? null,
            user_confirmed:      r.userConfirmed      ?? false,
            confirmed_at:        r.userConfirmed      ? now : null,
            autofill_completed:  r.autofillCompleted  ?? false,
            // Provenance of the number. NULL is reserved for legacy rows written before the
            // column existed — every new row states where its value came from.
            value_origin:        r.valueOrigin        ?? null,
          },
        })
      })
    )
    return NextResponse.json({ ok: true, count: results.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
