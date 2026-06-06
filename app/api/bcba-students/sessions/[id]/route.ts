import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { recalculateMonth } from '@/lib/bcba-students/recalculate-month'
import {
  isInvalidCategory,
  isValidCategory,
  invalidReason,
  deriveActivityType,
} from '@/lib/bcba-students/activity-categories'

export const dynamic = 'force-dynamic'

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function fmt12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

async function checkMvfLock(userId: string, monthYear: string): Promise<boolean> {
  const summary = await prisma.fieldwork_monthly_summaries.findFirst({
    where: { user_id: userId, month_year: monthYear },
    select: { mvf_signed: true },
  })
  return summary?.mvf_signed === true
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { id } = await params

  const existing = await prisma.fieldwork_sessions.findFirst({
    where: { id, user_id: userId },
    select: { session_date: true, month_year: true, is_locked: true },
  })

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Issue #1 fix: block edits on MVF-signed months
  if (existing.is_locked) {
    return NextResponse.json({
      error: 'This session is locked and cannot be deleted.',
    }, { status: 403 })
  }

  const monthYear = existing.month_year || existing.session_date.slice(0, 7)
  const mvfSigned = await checkMvfLock(userId, monthYear)
  if (mvfSigned) {
    return NextResponse.json({
      error: 'The M-FVF for this month has been signed. Sessions in a signed month cannot be deleted. Contact your supervisor if a correction is needed.',
    }, { status: 403 })
  }

  try {
    await prisma.fieldwork_sessions.delete({ where: { id } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

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

  const existing = await prisma.fieldwork_sessions.findFirst({
    where: { id, user_id: userId },
    select: { session_date: true, month_year: true, is_locked: true },
  })

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Issue #1 fix: block edits on MVF-signed months
  if (existing.is_locked) {
    return NextResponse.json({
      error: 'This session is locked and cannot be modified.',
    }, { status: 403 })
  }

  const oldMonthYear = existing.month_year || existing.session_date.slice(0, 7)
  const mvfSigned = await checkMvfLock(userId, oldMonthYear)
  if (mvfSigned) {
    return NextResponse.json({
      error: 'The M-FVF for this month has been signed. Sessions in a signed month cannot be edited. Contact your supervisor if a correction is needed.',
    }, { status: 403 })
  }

  // ── Activity category / type resolution ──────────────────────────────────
  const rawCategory = body.activity_category as string | undefined
  const rawActivityType = body.activity_type as string | undefined

  let activityType: 'restricted' | 'unrestricted'
  let activityCategory: string | null = null

  if (rawCategory) {
    if (isInvalidCategory(rawCategory)) {
      return NextResponse.json({
        error: `"${rawCategory}" is not valid BACB fieldwork. ${invalidReason(rawCategory)}`,
      }, { status: 400 })
    }
    if (!isValidCategory(rawCategory)) {
      return NextResponse.json({
        error: `Unknown activity category "${rawCategory}".`,
      }, { status: 400 })
    }
    activityCategory = rawCategory
    activityType = deriveActivityType(rawCategory)
  } else if (rawActivityType === 'restricted' || rawActivityType === 'unrestricted') {
    activityType = rawActivityType
  } else {
    return NextResponse.json({ error: 'Missing activity_category or activity_type' }, { status: 400 })
  }

  // ── contact_type consistency ─────────────────────────────────────────────
  const contactType = (body.contact_type as string | undefined) ?? 'none'
  if (activityType === 'restricted' && contactType !== 'client_observation') {
    return NextResponse.json({ error: 'Restricted activities must use contact_type "client_observation".' }, { status: 400 })
  }
  if (activityType === 'unrestricted' && contactType === 'client_observation') {
    return NextResponse.json({ error: 'Unrestricted activities cannot use contact_type "client_observation".' }, { status: 400 })
  }

  // ── client_reference ─────────────────────────────────────────────────────
  const clientReference = (body.client_reference as string | undefined)?.trim() ?? ''
  if (!clientReference) {
    return NextResponse.json({
      error: 'client_reference is required. Use a HIPAA-safe de-identified identifier (e.g. "Client A", "AJ-2026").',
    }, { status: 400 })
  }

  // ── session_note minimum ─────────────────────────────────────────────────
  const sessionNote = (body.session_note as string | undefined)?.trim() ?? ''
  if (sessionNote.length < 20) {
    return NextResponse.json({
      error: 'Session description must be at least 20 characters.',
    }, { status: 400 })
  }

  const indep = Number(body.independent_hours ?? 0)
  const sup = Number(body.supervised_hours ?? 0)
  const newMonthYear = (body.session_date as string).slice(0, 7)

  // Issue #7 fix: check 130-hour monthly cap on edit
  const monthSessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, month_year: newMonthYear, id: { not: id } },
    select: { total_hours: true },
  })
  const currentMonthTotal = monthSessions.reduce((s, d) => s + (Number(d.total_hours) || 0), 0)
  const newTotal = indep + sup
  if (currentMonthTotal + newTotal > 130) {
    const remaining = Math.max(0, 130 - currentMonthTotal)
    const monthLabel = new Date(newMonthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return NextResponse.json({
      error: `This edit would bring ${monthLabel} to ${(currentMonthTotal + newTotal).toFixed(2)} hours, exceeding the BACB maximum of 130. Maximum additional hours: ${remaining.toFixed(2)}.`,
    }, { status: 400 })
  }

  // ── Overlap check (exclude the session being edited) ─────────────────────
  const daySessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, session_date: body.session_date as string, id: { not: id } },
    select: { start_time: true, end_time: true },
  })

  const newStartMins = timeToMins(body.start_time as string)
  const newEndMins   = timeToMins(body.end_time as string)
  for (const s of daySessions) {
    if (s.start_time && s.end_time && newStartMins < timeToMins(s.end_time) && newEndMins > timeToMins(s.start_time)) {
      return NextResponse.json({
        error: `This session overlaps with an existing session on this date (${fmt12(s.start_time)} – ${fmt12(s.end_time)}). Please adjust your times.`,
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
        total_hours: newTotal,
        activity_type: activityType,
        activity_category: activityCategory,
        client_reference: clientReference,
        contact_type: contactType,
        setting: (body.setting as string | null | undefined) ?? null,
        supervisor_name: (body.supervisor_name as string | null | undefined) ?? null,
        session_note: sessionNote,
        // updated_at is handled automatically by Prisma @updatedAt
      },
    })

    await recalculateMonth(userId, newMonthYear).catch(err => console.error('[sessions/put] recalculate error:', err))

    if (oldMonthYear !== newMonthYear) {
      await recalculateMonth(userId, oldMonthYear).catch(err => console.error('[sessions/put] old-month recalculate error:', err))
    }

    return NextResponse.json({ session: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
