import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { recalculateMonth } from '@/lib/bcba-students/recalculate-month'

export const dynamic = 'force-dynamic'

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function fmt12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { searchParams } = new URL(req.url)
  const monthYear = searchParams.get('monthYear')

  const sessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, ...(monthYear ? { month_year: monthYear } : {}) },
    orderBy: { session_date: 'desc' },
  })

  return NextResponse.json({ sessions })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const required = ['session_date', 'start_time', 'end_time', 'activity_type']
  for (const f of required) {
    if (!body[f]) return NextResponse.json({ error: `Missing ${f}` }, { status: 400 })
  }

  const monthYear = (body.session_date as string).slice(0, 7)
  const indep = Number(body.independent_hours ?? 0)
  const sup = Number(body.supervised_hours ?? 0)
  const total = indep + sup

  // Enforce BACB monthly maximum of 130 hours
  const existingSessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, month_year: monthYear },
    select: { total_hours: true },
  })

  const currentMonthTotal = existingSessions.reduce((sum, s) => sum + (Number(s.total_hours) || 0), 0)
  const MONTHLY_MAX = 130
  if (currentMonthTotal + total > MONTHLY_MAX) {
    const remaining = Math.max(0, MONTHLY_MAX - currentMonthTotal)
    const monthLabel = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return NextResponse.json({
      error: `This session would bring your total for ${monthLabel} to ${(currentMonthTotal + total).toFixed(2)} hours, exceeding the BACB maximum of 130 hours per month. You can log a maximum of ${remaining.toFixed(2)} more hours this month.`
    }, { status: 400 })
  }

  // Overlap check — no two sessions on the same date can share any time
  const daySessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, session_date: body.session_date as string },
    select: { start_time: true, end_time: true },
  })

  const newStartMins = timeToMins(body.start_time as string)
  const newEndMins   = timeToMins(body.end_time as string)
  for (const s of daySessions) {
    if (s.start_time && s.end_time && newStartMins < timeToMins(s.end_time) && newEndMins > timeToMins(s.start_time)) {
      return NextResponse.json({
        error: `This session overlaps with an existing session on this date (${fmt12(s.start_time)} – ${fmt12(s.end_time)}). Please adjust your times.`
      }, { status: 400 })
    }
  }

  try {
    const data = await prisma.fieldwork_sessions.create({
      data: {
        user_id: userId,
        session_date: body.session_date as string,
        month_year: monthYear,
        start_time: body.start_time as string,
        end_time: body.end_time as string,
        independent_hours: indep,
        supervised_hours: sup,
        total_hours: total,
        activity_type: body.activity_type as string,
        contact_type: (body.contact_type as string | undefined) ?? 'none',
        setting: (body.setting as string | null | undefined) ?? null,
        supervisor_name: (body.supervisor_name as string | null | undefined) ?? null,
        session_note: (body.session_note as string | null | undefined) ?? null,
      },
    })

    console.log(`[sessions] inserted session for user=${userId} month=${monthYear} indep=${indep} sup=${sup} total=${total}`)

    // Recalculate monthly summary — awaited so the summary is fresh before the response returns
    await recalculateMonth(userId, monthYear).catch(err => console.error('[sessions] recalculate error:', err))

    return NextResponse.json({ session: data })
  } catch (err: any) {
    console.error('[sessions] insert error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
