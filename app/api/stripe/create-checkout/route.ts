import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getStripe, PRICES } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { resolveSubscriptionState, changePlan, PRIMARY_PRICE_IDS } from '@/lib/subscriptionState'

export async function POST(request: Request) {
  // SECURITY FIX: always get userId from server session, never trust client
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id as string

  const { plan, interval, promoCode } = await request.json()

  if (!plan || !interval) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const priceId = PRICES[plan as keyof typeof PRICES]?.[interval as 'month' | 'year']
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid plan or interval' }, { status: 400 })
  }

  // Get or create Stripe customer
  const sub = await prisma.subscriptions.findFirst({
    where: { user_id: userId },
    select: { stripe_customer_id: true },
  })

  let customerId = sub?.stripe_customer_id ?? null

  // THREE-WAY BRANCH (shared resolver): live -> change the existing subscription (no new sub, no new trial);
  // none -> checkout with a 7-day trial; lapsed -> checkout WITHOUT a trial (already had one). FAIL CLOSED:
  // if Stripe is unreachable we BLOCK (503) rather than mint a second subscription.
  const state = await resolveSubscriptionState(customerId, PRIMARY_PRICE_IDS)
  if (state.state === 'unavailable') {
    return NextResponse.json({ error: "We couldn't reach our billing provider — please try again in a moment." }, { status: 503 })
  }
  if (state.state === 'live') {
    const result = await changePlan({ liveSub: state.liveSub, itemId: state.itemId, newPriceId: priceId, newPlan: plan, userId, customerId })
    if (result.unchanged) return NextResponse.json({ unchanged: true, plan: result.plan })
    return NextResponse.json({ changed: true, plan: result.plan })
  }

  if (!customerId) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    const customer = await getStripe().customers.create({
      email: user?.email ?? undefined,
      metadata: { userId },
    })
    customerId = customer.id
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const sessionParams: Parameters<ReturnType<typeof getStripe>['checkout']['sessions']['create']>[0] = {
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    payment_method_collection: 'always',
    line_items: [{ price: priceId, quantity: 1 }],
    // Trial ONLY for a customer who has never subscribed to this product. 'lapsed' -> no repeat trial.
    ...(state.state === 'none' ? { subscription_data: { trial_period_days: 7 } } : {}),
    success_url: `${origin}/clients?subscription=success`,
    cancel_url: `${origin}/pricing`,
    metadata: { userId, plan, promoCode: promoCode || '' },
  }

  if (promoCode && process.env.STRIPE_PROMO_COUPON_ID) {
    sessionParams.discounts = [{ coupon: process.env.STRIPE_PROMO_COUPON_ID }]
  }

  const session2 = await getStripe().checkout.sessions.create(sessionParams)

  return NextResponse.json({ url: session2.url })
}
