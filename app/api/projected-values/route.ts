import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'
import { buildProjection } from '@/lib/projection'

type WeeklyPoint = { week: string; avg: number }

function toWeekStr(raw: unknown): string | null {
  if (!raw) return null
  const s = String(raw).replace(/T.*$/, '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function weeklyAggregate(
  records: any[],
  valueKey: string,
  mode: 'avg' | 'sum',
): WeeklyPoint[] {
  const map: Record<string, any[]> = {}
  records.forEach(r => {
    const w = toWeekStr(r.week_start) || toWeekStr(r.session_date)
    if (w) (map[w] = map[w] || []).push(r)
  })
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, recs]) => {
      const primary = recs[0]
      let avg: number
      if (mode === 'sum') {
        if (primary?.daily_values && Array.isArray(primary.daily_values) && primary.daily_values.length > 0) {
          avg = primary.daily_values.reduce((s: number, v: unknown) => s + (Number(v) || 0), 0)
        } else {
          avg = Math.round(recs.reduce((s: number, r: any) => s + (Number(r[valueKey]) || 0), 0))
        }
      } else {
        const vs = recs.map((r: any) => Number(r[valueKey]) || 0)
        avg = Math.round((vs.reduce((s: number, v: number) => s + v, 0) / vs.length) * 10) / 10
      }
      return { week, avg }
    })
}

function getProjectedValue(
  hist: WeeklyPoint[],
  projValues: number[],
  targetWeek: string,
): number | null {
  if (!hist.length) return null
  if (!projValues.length) return hist[hist.length - 1].avg

  const lastWeek = hist[hist.length - 1].week
  const diffMs =
    new Date(targetWeek + 'T00:00:00').getTime() -
    new Date(lastWeek + 'T00:00:00').getTime()
  const weeksAhead = Math.round(diffMs / (7 * 86400000))

  if (weeksAhead <= 0) return hist[hist.length - 1].avg
  const idx = Math.min(weeksAhead - 1, projValues.length - 1)
  return projValues[idx]
}

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // Default to this week's Monday if not provided
  const week = searchParams.get('week') || (() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.toISOString().split('T')[0]
  })()

  try {
    const [replData, maladData] = await Promise.all([
      prisma.replacement_data.findMany({
        where: { client_id: clientId },
        orderBy: { week_start: 'asc' },
      }),
      prisma.maladaptive_data.findMany({
        where: { client_id: clientId },
        orderBy: { week_start: 'asc' },
      }),
    ])

    const replBySkill: Record<string, any[]> = {}
    replData.forEach(r => {
      if (r.replacement_skill) (replBySkill[r.replacement_skill] = replBySkill[r.replacement_skill] || []).push(r)
    })

    const maladByBehavior: Record<string, any[]> = {}
    maladData.forEach(r => {
      if (r.behavior_name) (maladByBehavior[r.behavior_name] = maladByBehavior[r.behavior_name] || []).push(r)
    })

    const items: { name: string; type: string; projectedValue: number; dailyValue?: number; unit: string }[] = []

    Object.entries(replBySkill).forEach(([name, records], i) => {
      const hist = weeklyAggregate(records, 'observed_percentage', 'avg')
      if (!hist.length) return
      const last = hist[hist.length - 1].avg
      const proj = buildProjection(hist.map(d => d.avg), { baseline: last, goal: 100, totalWeeks: null }, i)
      const pv = getProjectedValue(hist, proj, week)
      if (pv != null) {
        items.push({ name, type: 'replacement', projectedValue: Math.min(100, Math.max(0, Math.round(pv))), unit: '%' })
      }
    })

    Object.entries(maladByBehavior).forEach(([name, records], i) => {
      const hist = weeklyAggregate(records, 'frequency', 'sum')
      if (!hist.length) return
      const last = hist[hist.length - 1].avg
      const proj = buildProjection(hist.map(d => d.avg), { baseline: last, goal: 0, totalWeeks: null }, i)
      const weeklyPv = getProjectedValue(hist, proj, week)
      if (weeklyPv != null) {
        const weeklyTotal = Math.max(0, Math.round(weeklyPv))
        const dailyPv = Math.max(0, Math.round(weeklyPv / 5))
        // projectedValue = weekly total (for Full Week Data tab)
        // dailyValue = per-session count (for Single Day OP datasheet autofill)
        items.push({ name, type: 'maladaptive', projectedValue: weeklyTotal, dailyValue: dailyPv, unit: '' })
      }
    })

    return NextResponse.json({ ok: true, week, items })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
