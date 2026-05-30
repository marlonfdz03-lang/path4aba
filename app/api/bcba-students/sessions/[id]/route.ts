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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { id } = await params

  // Fetch session first to get month_year for recalc
  const existing = await prisma.fieldwork_sessions.findFirst({
    where: { id, user_id: userId },
    select: { session_date: true, month_year: true },
  })

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    await prisma.fieldwork_sessions.delete({ where: { id } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const monthYear = existing.month_year || existing.session_date.slice(0, 7)
  await recalculateMonth(userId, monthYear).catch(err => console.error('[sessions/delete] recalculate error:', err))

  return NextResponse.json({ ok: true })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Verify ownership
  const existing = await prisma.fieldwork_sessions.findFirst({
    where: { id, user_id: userId },
    select: { session_date: true, month_year: true },
  })

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const indep = Number(body.independent_hours ?? 0)
  const sup = Number(body.supervised_hours ?? 0)
  const newMonthYear = (body.session_date as string).slice(0, 7)

  // Overlap check — exclude the session being edited
  const daySessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, session_date: body.session_date as string, id: { not: id } },
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
    const data = await prisma.fieldwork_sessions.update({
      where: { id },
      data: {
        session_date: body.session_date as string,
        month_year: newMonthYear,
        start_time: body.start_time as string,
        end_time: body.end_time as string,
        independent_hours: indep,
        supervised_hours: sup,
        total_hours: indep + sup,
        activity_type: body.activity_type as string,
        contact_type: body.contact_type as string,
        setting: (body.setting as string | null | undefined) ?? null,
        supervisor_name: (body.supervisor_name as string | null | undefined) ?? null,
        session_note: (body.session_note as string | null | undefined) ?? null,
      },
    })

    await recalculateMonth(userId, newMonthYear).catch(err => console.error('[sessions/put] recalculate error:', err))

    // If the session moved to a different month, recalculate the old month too
    const oldMonthYear = existing.month_year || existing.session_date.slice(0, 7)
    if (oldMonthYear !== newMonthYear) {
      await recalculateMonth(userId, oldMonthYear).catch(err => console.error('[sessions/put] old-month recalculate error:', err))
    }

    return NextResponse.json({ session: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
