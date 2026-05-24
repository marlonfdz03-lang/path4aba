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

export async function POST(req: Request, { params }: { params: Promise<{ monthYear: string }> }) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { monthYear } = await params

  await recalculateMonth(user.id, monthYear).catch(err => {
    console.error('[recalculate] error:', err)
  })

  const { data, error } = await supabaseServer
    .from('fieldwork_monthly_summaries')
    .select('*')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ summary: data })
}
