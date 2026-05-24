import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only return summaries for months that have at least one session logged
  const { data: sessionMonths, error: sessErr } = await supabaseServer
    .from('fieldwork_sessions')
    .select('month_year')
    .eq('user_id', user.id)

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 })

  const monthsWithSessions = [...new Set((sessionMonths || []).map(r => r.month_year as string).filter(Boolean))]

  if (monthsWithSessions.length === 0) {
    return NextResponse.json({ summaries: [] })
  }

  const { data, error } = await supabaseServer
    .from('fieldwork_monthly_summaries')
    .select('*')
    .eq('user_id', user.id)
    .in('month_year', monthsWithSessions)
    .order('month_year', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ summaries: data || [] })
}
