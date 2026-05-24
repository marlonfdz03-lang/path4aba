import { NextResponse } from 'next/server'
import { getStripe, PRICES } from '@/lib/stripe'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: Request) {
  const { plan, interval, userId, promoCode } = await request.json()

  if (!plan || !interval || !userId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const priceId = PRICES[plan as keyof typeof PRICES]?.[interval as 'month' | 'year']
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid plan or interval' }, { status: 400 })
  }

  // Get or create Stripe customer
  const { data: sub } = await supabaseServer
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()

  let customerId = sub?.stripe_customer_id ?? null

  if (!customerId) {
    const { data: { user } } = await supabaseServer.auth.admin.getUserById(userId)
    const customer = await getStripe().customers.create({
      email: user?.email,
      metadata: { userId },
    })
    customerId = customer.id
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const sessionParams: Parameters<ReturnType<typeof getStripe>['checkout']['sessions']['create']>[0] = {
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { trial_period_days: 7 },
    success_url: `${origin}/dashboard?subscription=success`,
    cancel_url: `${origin}/pricing`,
    metadata: { userId, plan, promoCode: promoCode || '' },
  }

  // Apply promo coupon if provided and env var is set
  if (promoCode && process.env.STRIPE_PROMO_COUPON_ID) {
    sessionParams.discounts = [{ coupon: process.env.STRIPE_PROMO_COUPON_ID }]
  }

  const session = await getStripe().checkout.sessions.create(sessionParams)

  return NextResponse.json({ url: session.url })
}
