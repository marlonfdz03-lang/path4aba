import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const sessionMonths = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId },
    select: { month_year: true },
  })

  const monthsWithSessions = [...new Set(sessionMonths.map(r => r.month_year).filter(Boolean))]

  if (monthsWithSessions.length === 0) {
    return NextResponse.json({ summaries: [], warnings: [] })
  }

  const summaries = await prisma.fieldwork_monthly_summaries.findMany({
    where: { user_id: userId, month_year: { in: monthsWithSessions } },
    orderBy: { month_year: 'asc' },
  })

  // ── Suspicious pattern detection (Priority 5) ────────────────────────────
  const warnings: string[] = []

  // Pattern A: 3+ consecutive months at exactly 130 hours
  let consecutiveMax = 0
  let consecutiveMaxStart = ''
  for (const s of summaries) {
    if (s.total_hours === 130) {
      if (consecutiveMax === 0) consecutiveMaxStart = s.month_year
      consecutiveMax++
      if (consecutiveMax >= 3) {
        warnings.push(
          `Maximum hours (130) logged for 3 or more consecutive months starting ${consecutiveMaxStart}. This pattern may appear unusual in a BACB audit review.`
        )
        break
      }
    } else {
      consecutiveMax = 0
      consecutiveMaxStart = ''
    }
  }

  // Pattern B: 7+ consecutive sessions with identical total_hours
  const allSessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId },
    select: { session_date: true, total_hours: true },
    orderBy: { session_date: 'asc' },
  })

  if (allSessions.length >= 7) {
    let streak = 1
    let streakValue = allSessions[0]?.total_hours ?? -1
    for (let i = 1; i < allSessions.length; i++) {
      const h = allSessions[i].total_hours
      if (h === streakValue && h > 0) {
        streak++
        if (streak >= 7) {
          warnings.push(
            `Identical session duration (${streakValue.toFixed(2)} hrs) logged for 7 or more consecutive sessions. Repetitive patterns may be flagged in a BACB audit.`
          )
          break
        }
      } else {
        streak = 1
        streakValue = h
      }
    }
  }

  return NextResponse.json({
    summaries: [...summaries].sort((a, b) => b.month_year.localeCompare(a.month_year)),
    warnings,
  })
}
