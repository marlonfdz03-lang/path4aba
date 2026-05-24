import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
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

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const monthYear = searchParams.get('monthYear')

  let query = supabaseServer
    .from('fieldwork_sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('session_date', { ascending: false })

  if (monthYear) query = query.eq('month_year', monthYear)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sessions: data || [] })
}

export async function POST(req: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  const { data: existingSessions } = await supabaseServer
    .from('fieldwork_sessions')
    .select('total_hours')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)

  const currentMonthTotal = (existingSessions || []).reduce((sum, s) => sum + (Number(s.total_hours) || 0), 0)
  const MONTHLY_MAX = 130
  if (currentMonthTotal + total > MONTHLY_MAX) {
    const remaining = Math.max(0, MONTHLY_MAX - currentMonthTotal)
    const monthLabel = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return NextResponse.json({
      error: `This session would bring your total for ${monthLabel} to ${(currentMonthTotal + total).toFixed(2)} hours, exceeding the BACB maximum of 130 hours per month. You can log a maximum of ${remaining.toFixed(2)} more hours this month.`
    }, { status: 400 })
  }

  // Overlap check — no two sessions on the same date can share any time
  const { data: daySessions } = await supabaseServer
    .from('fieldwork_sessions')
    .select('start_time, end_time')
    .eq('user_id', user.id)
    .eq('session_date', body.session_date)

  const newStartMins = timeToMins(body.start_time as string)
  const newEndMins   = timeToMins(body.end_time as string)
  for (const s of (daySessions || [])) {
    if (newStartMins < timeToMins(s.end_time) && newEndMins > timeToMins(s.start_time)) {
      return NextResponse.json({
        error: `This session overlaps with an existing session on this date (${fmt12(s.start_time)} – ${fmt12(s.end_time)}). Please adjust your times.`
      }, { status: 400 })
    }
  }

  const { data, error } = await supabaseServer
    .from('fieldwork_sessions')
    .insert({
      user_id: user.id,
      session_date: body.session_date,
      month_year: monthYear,
      start_time: body.start_time,
      end_time: body.end_time,
      independent_hours: indep,
      supervised_hours: sup,
      total_hours: total,
      activity_type: body.activity_type,
      contact_type: body.contact_type ?? 'none',
      setting: body.setting ?? null,
      supervisor_name: body.supervisor_name ?? null,
      session_note: body.session_note ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('[sessions] insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[sessions] inserted session for user=${user.id} month=${monthYear} indep=${indep} sup=${sup} total=${total}`)

  // Recalculate monthly summary — awaited so the summary is fresh before the response returns
  await recalculateMonth(user.id, monthYear).catch(err => console.error('[sessions] recalculate error:', err))

  return NextResponse.json({ session: data })
}
