import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { principalCanAccessClient, principalCanAccessRow } from '@/lib/clientFiles'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  try {
    const [replRows, maladRows] = await Promise.all([
      prisma.replacement_data.findMany({
        where: { client_id: clientId, is_anomaly: true, anomaly_reviewed: true, autofill_completed: false },
        select: {
          id: true,
          replacement_skill: true,
          session_date: true,
          week_start: true,
          observed_percentage: true,
          original_value: true,
          anomaly_justification: true,
          total_trials: true,
        },
        orderBy: { session_date: 'desc' },
        take: 50,
      }),
      prisma.maladaptive_data.findMany({
        where: { client_id: clientId, is_anomaly: true, anomaly_reviewed: true, autofill_completed: false },
        select: {
          id: true,
          behavior_name: true,
          session_date: true,
          week_start: true,
          frequency: true,
          original_value: true,
          anomaly_justification: true,
        },
        orderBy: { session_date: 'desc' },
        take: 50,
      }),
    ])

    const corrections = [
      ...replRows.map(r => ({
        id: r.id,
        type: 'replacement' as const,
        name: r.replacement_skill,
        sessionDate: r.session_date,
        weekStart: r.week_start,
        currentValue: r.observed_percentage,
        originalValue: r.original_value,
        justification: r.anomaly_justification,
        totalTrials: r.total_trials,
      })),
      ...maladRows.map(r => ({
        id: r.id,
        type: 'maladaptive' as const,
        name: r.behavior_name,
        sessionDate: r.session_date,
        weekStart: r.week_start,
        currentValue: r.frequency,
        originalValue: r.original_value,
        justification: r.anomaly_justification,
        totalTrials: null,
      })),
    ].sort((a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || ''))

    return NextResponse.json({ corrections })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id, type } = await req.json()
    if (!id || !type) return NextResponse.json({ error: 'id and type required' }, { status: 400 })

    // `type` selects the table for BOTH the ownership lookup AND the mutation — resolved to ONE delegate
    // here so they can never diverge. An unexpected/invalid type is rejected before any DB access, so a
    // caller cannot point the ownership lookup at a table where the id happens to be theirs while the write
    // lands on another table.
    const model: any =
      type === 'replacement' ? prisma.replacement_data :
      type === 'maladaptive' ? prisma.maladaptive_data :
      null
    if (!model) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

    // Resolve the row's owning client from the SAME table; deny on missing row / null client_id / non-owner.
    if (!(await principalCanAccessRow({ id: user.id, role: user.role }, (rid) =>
      model.findUnique({ where: { id: rid }, select: { client_id: true } }), id)))
      return NextResponse.json({ error: 'You do not have access to this row.' }, { status: 403 })

    await model.update({ where: { id }, data: { autofill_completed: true } })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
