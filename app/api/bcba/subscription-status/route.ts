import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'


export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ isBCBAPro: false })
  const userId = (session.user as any).id as string


  const sub = await prisma.subscriptions.findFirst({
    where: { user_id: userId },
    select: { plan: true, status: true, trial_ends_at: true },
  })

  const now = new Date()
  const isBCBAPro =
    sub?.plan === 'bcba_pro' &&
    (sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at != null && new Date(sub.trial_ends_at) > now))

  return NextResponse.json({ isBCBAPro: !!isBCBAPro })
}
