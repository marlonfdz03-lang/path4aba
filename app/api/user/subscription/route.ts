import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ sub: null, isBCBAPro: false, hasBCBAStudents: false, hasActiveRBT: false })
  const userId = (session.user as any).id as string

  if (!UUID_RE.test(userId)) return NextResponse.json({ sub: null, isBCBAPro: false, hasBCBAStudents: false, hasActiveRBT: false })

  const sub = await prisma.subscriptions.findFirst({
    where: { user_id: userId },
    select: {
      plan: true,
      status: true,
      trial_ends_at: true,
      current_period_ends_at: true,
      stripe_customer_id: true,
      bcba_students_status: true,
      bcba_students_trial_ends_at: true,
    },
  })

  const now = new Date()

  const isBCBAPro =
    sub?.plan === 'bcba_pro' &&
    (sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at != null && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at != null && new Date(sub.current_period_ends_at) > now))

  const hasBCBAStudents =
    sub?.bcba_students_status === 'active' ||
    (sub?.bcba_students_status === 'trialing' &&
      sub.bcba_students_trial_ends_at != null &&
      new Date(sub.bcba_students_trial_ends_at) > now)

  const hasActiveRBT =
    sub?.plan === 'rbt' &&
    (sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at != null && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at != null && new Date(sub.current_period_ends_at) > now))

  return NextResponse.json({
    sub: sub
      ? {
          plan: sub.plan,
          status: sub.status,
          trial_ends_at: sub.trial_ends_at,
          current_period_ends_at: sub.current_period_ends_at,
          stripe_customer_id: sub.stripe_customer_id,
        }
      : null,
    isBCBAPro: !!isBCBAPro,
    hasBCBAStudents: !!hasBCBAStudents,
    hasActiveRBT: !!hasActiveRBT,
  })
}
