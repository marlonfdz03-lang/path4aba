import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ monthYear: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { monthYear } = await params

  const sessions = await prisma.fieldwork_sessions.findMany({
    where: { user_id: userId, month_year: monthYear },
    orderBy: { session_date: 'asc' },
  })

  return NextResponse.json({ sessions })
}
