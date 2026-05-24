import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { recalculateMonth } from '@/lib/bcba-students/recalculate-month'

export const dynamic = 'force-dynamic'

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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Fetch session first to get month_year for recalc
  const { data: session } = await supabaseServer
    .from('fieldwork_sessions')
    .select('session_date, month_year')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseServer
    .from('fieldwork_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const monthYear = session.month_year || session.session_date.slice(0, 7)
  await recalculateMonth(user.id, monthYear).catch(err => console.error('[sessions/delete] recalculate error:', err))

  return NextResponse.json({ ok: true })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Verify ownership
  const { data: existing } = await supabaseServer
    .from('fieldwork_sessions')
    .select('session_date, month_year')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const indep = Number(body.independent_hours ?? 0)
  const sup = Number(body.supervised_hours ?? 0)
  const newMonthYear = (body.session_date as string).slice(0, 7)

  const { data, error } = await supabaseServer
    .from('fieldwork_sessions')
    .update({
      session_date: body.session_date,
      month_year: newMonthYear,
      start_time: body.start_time,
      end_time: body.end_time,
      independent_hours: indep,
      supervised_hours: sup,
      total_hours: indep + sup,
      activity_type: body.activity_type,
      contact_type: body.contact_type,
      setting: body.setting ?? null,
      supervisor_name: body.supervisor_name ?? null,
      session_note: body.session_note ?? null,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recalculateMonth(user.id, newMonthYear).catch(err => console.error('[sessions/put] recalculate error:', err))

  // If the session moved to a different month, recalculate the old month too
  const oldMonthYear = existing.month_year || existing.session_date.slice(0, 7)
  if (oldMonthYear !== newMonthYear) {
    await recalculateMonth(user.id, oldMonthYear).catch(err => console.error('[sessions/put] old-month recalculate error:', err))
  }

  return NextResponse.json({ session: data })
}
