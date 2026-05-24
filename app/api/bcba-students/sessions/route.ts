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
