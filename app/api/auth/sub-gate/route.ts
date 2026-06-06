import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Internal endpoint called by proxy to check subscription status.
// Returns { hasAccess: boolean } only — no sensitive data.
// No secret required: the response is a boolean and userId is a non-guessable cuid.
export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) {
    console.log('[sub-gate] missing userId')
    return NextResponse.json({ hasAccess: false })
  }

  try {
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: userId },
      select: { status: true, trial_ends_at: true, current_period_ends_at: true },
    })

    console.log('[sub-gate] userId:', userId, 'sub:', sub ? JSON.stringify(sub) : 'null')

    if (!sub) {
      console.log('[sub-gate] no subscription row found → hasAccess: false')
      return NextResponse.json({ hasAccess: false })
    }

    const now = new Date()
    const hasAccess =
      sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at != null && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at != null && new Date(sub.current_period_ends_at) > now)

    console.log('[sub-gate] status:', sub.status, '→ hasAccess:', hasAccess)
    return NextResponse.json({ hasAccess: !!hasAccess })
  } catch (err) {
    console.error('[sub-gate] DB error:', err)
    // Fail open — don't lock users out if DB is unavailable
    return NextResponse.json({ hasAccess: true })
  }
}
