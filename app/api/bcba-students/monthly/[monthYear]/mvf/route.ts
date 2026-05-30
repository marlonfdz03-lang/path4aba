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

  await prisma.fieldwork_monthly_summaries.updateMany({
    where: { user_id: userId, month_year: monthYear },
    data: { mvf_signed: true, mvf_signed_at: new Date() },
  })

  // Re-check eligibility now that MVF is signed
  await recalculateMonth(userId, monthYear)

  return NextResponse.json({ ok: true })
}
