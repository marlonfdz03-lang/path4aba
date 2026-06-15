import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  try {
    const [replRows, maladRows] = await Promise.all([
      prisma.replacement_data.findMany({
        where: { client_id: clientId, is_anomaly: true, anomaly_reviewed: false },
        select: {
          id: true,
          replacement_skill: true,
          session_date: true,
          week_start: true,
          observed_percentage: true,
          original_value: true,
          anomaly_justification: true,
        },
        orderBy: { session_date: 'desc' },
        take: 50,
      }),
      prisma.maladaptive_data.findMany({
        where: { client_id: clientId, is_anomaly: true, anomaly_reviewed: false },
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

    if (type === 'replacement') {
      await prisma.replacement_data.update({
        where: { id },
        data: { anomaly_reviewed: true },
      })
    } else if (type === 'maladaptive') {
      await prisma.maladaptive_data.update({
        where: { id },
        data: { anomaly_reviewed: true },
      })
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
