import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  // Only return summaries for months that have at least one session logged
  const sessionMonths = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId },
    select: { month_year: true },
  })

  const monthsWithSessions = [...new Set(sessionMonths.map(r => r.month_year).filter(Boolean))]

  if (monthsWithSessions.length === 0) {
    return NextResponse.json({ summaries: [] })
  }

  const summaries = await prisma.fieldwork_monthly_summaries.findMany({
    where: { user_id: userId, month_year: { in: monthsWithSessions } },
    orderBy: { month_year: 'desc' },
  })

  return NextResponse.json({ summaries })
}
