import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId')

  console.log('[sub-gate] userId received:', userId)

  if (!userId) {
    console.log('[sub-gate] no userId → hasAccess: false')
    return NextResponse.json({ hasAccess: false })
  }

  try {
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: userId },
      select: {
        status: true,
        trial_ends_at: true,
        current_period_ends_at: true,
        plan: true,
        user_id: true,
      },
    })

    console.log('[sub-gate] raw sub row:', JSON.stringify(sub))
    console.log('[sub-gate] status:', sub?.status)
    console.log('[sub-gate] trial_ends_at:', sub?.trial_ends_at)
    console.log('[sub-gate] current_period_ends_at:', sub?.current_period_ends_at)

    if (!sub) {
      console.log('[sub-gate] no subscription row found → hasAccess: false')
      return NextResponse.json({ hasAccess: false })
    }

    const now = new Date()
    const hasAccess =
      sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at != null && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at != null && new Date(sub.current_period_ends_at) > now)

    console.log('[sub-gate] hasAccess result:', hasAccess, '| now:', now.toISOString())
    return NextResponse.json({ hasAccess: !!hasAccess })
  } catch (err) {
    console.error('[sub-gate] DB error:', err)
    // Fail open — don't lock out users if DB is unavailable
    return NextResponse.json({ hasAccess: true })
  }
}
