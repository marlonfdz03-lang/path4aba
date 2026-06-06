import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Internal-only endpoint called by middleware to check subscription status.
// Returns { hasAccess: boolean } — no sensitive data exposed.
export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) return NextResponse.json({ hasAccess: false })

  // Verify the request came from our own middleware via shared secret
  const secret = req.headers.get('x-sub-gate-secret')
  const expected = process.env.SUB_GATE_SECRET
  if (expected && secret !== expected) {
    return NextResponse.json({ hasAccess: false }, { status: 403 })
  }

  try {
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: userId },
      select: { status: true, trial_ends_at: true, current_period_ends_at: true },
    })

    if (!sub) return NextResponse.json({ hasAccess: false })

    const now = new Date()
    const hasAccess =
      sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at != null && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at != null && new Date(sub.current_period_ends_at) > now)

    return NextResponse.json({ hasAccess: !!hasAccess })
  } catch (err) {
    console.error('[sub-gate] DB error:', err)
    // Fail open — don't lock users out if DB is unavailable
    return NextResponse.json({ hasAccess: true })
  }
}
