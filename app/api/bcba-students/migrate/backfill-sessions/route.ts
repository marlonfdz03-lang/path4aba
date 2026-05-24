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

export async function POST() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Find rows with missing month_year or zero total_hours for this user
  const { data: staleRows, error: fetchError } = await supabaseServer
    .from('fieldwork_sessions')
    .select('id, session_date, independent_hours, supervised_hours')
    .eq('user_id', user.id)
    .or('month_year.is.null,total_hours.eq.0')

  if (fetchError) {
    console.error('[backfill] fetch error:', fetchError)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const rows = staleRows || []
  console.log(`[backfill] user=${user.id} found ${rows.length} stale rows`)

  // 2. Backfill each stale row
  let fixedCount = 0
  for (const row of rows) {
    const monthYear = (row.session_date as string).slice(0, 7)
    const indep = Number(row.independent_hours ?? 0)
    const sup = Number(row.supervised_hours ?? 0)

    const { error: rowErr } = await supabaseServer
      .from('fieldwork_sessions')
      .update({ month_year: monthYear, total_hours: indep + sup })
      .eq('id', row.id)
      .eq('user_id', user.id)

    if (rowErr) {
      console.error(`[backfill] failed to update row ${row.id}:`, rowErr)
    } else {
      fixedCount++
    }
  }

  console.log(`[backfill] fixed ${fixedCount}/${rows.length} rows`)

  // 3. Get all distinct month_years for this user (now that month_year is populated)
  const { data: monthRows, error: monthErr } = await supabaseServer
    .from('fieldwork_sessions')
    .select('month_year')
    .eq('user_id', user.id)

  if (monthErr) {
    console.error('[backfill] month fetch error:', monthErr)
    return NextResponse.json({ error: monthErr.message }, { status: 500 })
  }

  const distinctMonths = [
    ...new Set((monthRows || []).map(r => r.month_year as string).filter(Boolean)),
  ]

  console.log(`[backfill] recalculating ${distinctMonths.length} months:`, distinctMonths)

  // 4. Recalculate each distinct month in sequence
  const recalcResults: Array<{ month: string; ok: boolean; error?: string }> = []
  for (const month of distinctMonths) {
    try {
      await recalculateMonth(user.id, month)
      recalcResults.push({ month, ok: true })
    } catch (e: any) {
      console.error(`[backfill] recalculate failed for month=${month}:`, e)
      recalcResults.push({ month, ok: false, error: e.message })
    }
  }

  const succeeded = recalcResults.filter(r => r.ok).length
  const failed = recalcResults.filter(r => !r.ok).length

  return NextResponse.json({
    rowsFixed: fixedCount,
    rowsStale: rows.length,
    monthsRecalculated: succeeded,
    monthsFailed: failed,
    months: recalcResults,
  })
}
