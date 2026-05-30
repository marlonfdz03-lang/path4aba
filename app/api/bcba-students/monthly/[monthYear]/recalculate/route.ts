import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { recalculateMonth } from '@/lib/bcba-students/recalculate-month'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ monthYear: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { monthYear } = await params

  await recalculateMonth(userId, monthYear).catch(err => {
    console.error('[recalculate] error:', err)
  })

  const summary = await prisma.fieldwork_monthly_summaries.findFirst({
    where: { user_id: userId, month_year: monthYear },
  })

  return NextResponse.json({ summary })
}
