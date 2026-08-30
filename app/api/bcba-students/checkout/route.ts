import { NextResponse } from 'next/server'
import { getStripe, BCBA_STUDENTS_PRICES } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { resolveSubscriptionState, changePlan, STUDENTS_PRICE_IDS } from '@/lib/subscriptionState'

export const dynamic = 'force-dynamic'

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const SUCCESS_URL = `${ORIGIN}/bcba-students?trial=started`
const CANCEL_URL = `${ORIGIN}/pricing`

export async function POST(req: Request) {
  let body: { userId?: string; interval?: 'month' | 'year' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { userId, interval = 'month' } = body
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const user = await prisma.users.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const sub = await prisma.subscriptions.findFirst({
    where: { user_id: userId },
    select: { status: true, plan: true, stripe_customer_id: true, trial_ends_at: true, current_period_ends_at: true },
  })

  const now = new Date()
  const hasActiveRBT =
    (sub?.plan === 'rbt_1' || sub?.plan === 'rbt_2') &&
    (sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at && new Date(sub.current_period_ends_at) > now))

  const priceSet = hasActiveRBT ? BCBA_STUDENTS_PRICES.addon : BCBA_STUDENTS_PRICES.standalone
  const priceId = priceSet[interval]

  if (!priceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 })
  }

  let customerId = sub?.stripe_customer_id ?? null

  // THREE-WAY BRANCH (shared resolver), scoped to the bcba_students product (its OWN subscription, distinct
  // from any RBT plan the customer may also hold). live -> change the existing students subscription; none ->
  // checkout with a 7-day trial; lapsed -> checkout WITHOUT a trial. FAIL CLOSED -> 503.
  const state = await resolveSubscriptionState(customerId, STUDENTS_PRICE_IDS)
  if (state.state === 'unavailable') {
    return NextResponse.json({ error: "We couldn't reach our billing provider — please try again in a moment." }, { status: 503 })
  }
  if (state.state === 'live') {
    const result = await changePlan({ liveSub: state.liveSub, itemId: state.itemId, newPriceId: priceId, newPlan: 'bcba_students', userId, customerId })
    if (result.unchanged) return NextResponse.json({ unchanged: true, plan: 'bcba_students' })
    return NextResponse.json({ changed: true, plan: 'bcba_students' })
  }

  if (!customerId) {
    const customer = await getStripe().customers.create({
      email: user.email,
      metadata: { userId },
    })
    customerId = customer.id
  }

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    payment_method_collection: 'always',
    line_items: [{ price: priceId, quantity: 1 }],
    // Trial ONLY for a first-time bcba_students customer. 'lapsed' -> no repeat trial.
    ...(state.state === 'none' ? { subscription_data: { trial_period_days: 7 } } : {}),
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    metadata: { userId, plan: 'bcba_students' },
  })

  return NextResponse.json({ url: session.url })
}
