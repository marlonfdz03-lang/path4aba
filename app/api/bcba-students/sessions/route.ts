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

  // ── Required fields ──────────────────────────────────────────────────────
  const required = ['session_date', 'start_time', 'end_time']
  for (const f of required) {
    if (!body[f]) return NextResponse.json({ error: `Missing ${f}` }, { status: 400 })
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
        error: `Unknown activity category "${rawCategory}". Please select a valid BACB fieldwork category.`,
      }, { status: 400 })
    }
    activityCategory = rawCategory
    activityType = deriveActivityType(rawCategory) // server-side derivation — never trust frontend
  } else if (rawActivityType === 'restricted' || rawActivityType === 'unrestricted') {
    activityType = rawActivityType
  } else {
    return NextResponse.json({ error: 'Missing activity_category or activity_type' }, { status: 400 })
  }

  // ── contact_type consistency ─────────────────────────────────────────────
  const contactType = (body.contact_type as string | undefined) ?? 'none'
  const restrictedContactTypes = new Set(['client_observation'])
  const supervisionContactTypes = new Set(['individual_supervision', 'group_supervision'])

  if (activityType === 'restricted' && !restrictedContactTypes.has(contactType)) {
    return NextResponse.json({
      error: 'Restricted activities must use contact_type "client_observation".',
    }, { status: 400 })
  }
  if (activityType === 'unrestricted' && contactType === 'client_observation') {
    return NextResponse.json({
      error: 'Unrestricted activities cannot use contact_type "client_observation".',
    }, { status: 400 })
  }

  // ── client_reference (required for all valid submissions) ────────────────
  const clientReference = (body.client_reference as string | undefined)?.trim() ?? ''
  if (!clientReference) {
    return NextResponse.json({
      error: 'client_reference is required. Use a HIPAA-safe de-identified identifier (e.g. "Client A", "AJ-2026").',
    }, { status: 400 })
  }

  // ── session_note minimum 20 characters ───────────────────────────────────
  const sessionNote = (body.session_note as string | undefined)?.trim() ?? ''
  if (sessionNote.length < 20) {
    return NextResponse.json({
      error: 'Session description must be at least 20 characters. Provide a specific description of what was worked on.',
    }, { status: 400 })
  }

  // ── Hours calculation ────────────────────────────────────────────────────
  const monthYear = (body.session_date as string).slice(0, 7)
  const indep = Number(body.independent_hours ?? 0)
  const sup = Number(body.supervised_hours ?? 0)
  const total = indep + sup

  // ── Daily 8-hour limit (server-side enforcement) ─────────────────────────
  const daySessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, session_date: body.session_date as string },
    select: { start_time: true, end_time: true, total_hours: true },
  })

  const dailyTotal = daySessions.reduce((s, d) => s + (Number(d.total_hours) || 0), 0)
  const DAILY_MAX = 8
  if (dailyTotal + total > DAILY_MAX) {
    const remaining = Math.max(0, DAILY_MAX - dailyTotal)
    const dateLabel = new Date((body.session_date as string) + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    return NextResponse.json({
      error: `You cannot log more than 8 hours per day. You have ${dailyTotal.toFixed(2)} hrs logged on ${dateLabel}. Remaining: ${remaining.toFixed(2)} hrs.`,
    }, { status: 400 })
  }

  // ── Monthly 130-hour BACB cap ────────────────────────────────────────────
  const monthSessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, month_year: monthYear },
    select: { total_hours: true },
  })

  const currentMonthTotal = monthSessions.reduce((sum, s) => sum + (Number(s.total_hours) || 0), 0)
  const MONTHLY_MAX = 130
  if (currentMonthTotal + total > MONTHLY_MAX) {
    const remaining = Math.max(0, MONTHLY_MAX - currentMonthTotal)
    const monthLabel = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return NextResponse.json({
      error: `This session would bring your total for ${monthLabel} to ${(currentMonthTotal + total).toFixed(2)} hours, exceeding the BACB maximum of 130 hours per month. You can log a maximum of ${remaining.toFixed(2)} more hours this month.`,
    }, { status: 400 })
  }

  // ── Overlap check ────────────────────────────────────────────────────────
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
        activity_type: activityType,
        activity_category: activityCategory,
        client_reference: clientReference,
        contact_type: contactType,
        setting: (body.setting as string | null | undefined) ?? null,
        supervisor_name: (body.supervisor_name as string | null | undefined) ?? null,
        session_note: sessionNote,
      },
    })

    console.log(`[sessions] inserted session for user=${userId} month=${monthYear} indep=${indep} sup=${sup} total=${total} category=${activityCategory}`)

    await recalculateMonth(userId, monthYear).catch(err => console.error('[sessions] recalculate error:', err))

    return NextResponse.json({ session: data })
  } catch (err: any) {
    console.error('[sessions] insert error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
