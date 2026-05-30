import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { recalculateMonth } from '@/lib/bcba-students/recalculate-month'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  // 1. Find rows with zero total_hours for this user
  const staleRows = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, total_hours: 0 },
    select: { id: true, session_date: true, independent_hours: true, supervised_hours: true },
  })

  const rows = staleRows
  console.log(`[backfill] user=${userId} found ${rows.length} stale rows`)

  // 2. Backfill each stale row
  let fixedCount = 0
  for (const row of rows) {
    const monthYear = row.session_date.slice(0, 7)
    const indep = Number(row.independent_hours ?? 0)
    const sup = Number(row.supervised_hours ?? 0)

    try {
      await prisma.fieldwork_sessions.update({
        where: { id: row.id },
        data: { month_year: monthYear, total_hours: indep + sup },
      })
      fixedCount++
    } catch (rowErr: any) {
      console.error(`[backfill] failed to update row ${row.id}:`, rowErr)
    }
  }

  console.log(`[backfill] fixed ${fixedCount}/${rows.length} rows`)

  // 3. Get all distinct month_years for this user
  const monthRows = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId },
    select: { month_year: true },
  })

  const distinctMonths = [...new Set(monthRows.map(r => r.month_year).filter(Boolean))]

  console.log(`[backfill] recalculating ${distinctMonths.length} months:`, distinctMonths)

  // 4. Recalculate each distinct month in sequence
  const recalcResults: Array<{ month: string; ok: boolean; error?: string }> = []
  for (const month of distinctMonths) {
    try {
      await recalculateMonth(userId, month)
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
