import { NextResponse } from 'next/server'
import { getStripe, PRICES, BCBA_STUDENTS_PRICES } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { sendWelcomeEmail } from '@/lib/email'

export async function POST(request: Request) {
  let body: { userId?: string; plan?: string; interval?: string; promoCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { userId, plan, promoCode } = body
  const interval = (body.interval === 'year' ? 'year' : 'month') as 'month' | 'year'

  console.log('[create-trial] request:', { userId, plan })

  if (!userId || !plan) {
    return NextResponse.json({ error: 'Missing userId or plan' }, { status: 400 })
  }

  // Verify user exists
  const user = await prisma.users.findUnique({ where: { id: userId } })
  if (!user) {
    console.error('[create-trial] User not found:', userId)
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Resolve price ID from plan key and interval
  let priceId: string | undefined

  if (plan === 'bcba_students_addon') {
    priceId = BCBA_STUDENTS_PRICES.addon[interval]
  } else if (plan === 'bcba_students_standalone') {
    priceId = BCBA_STUDENTS_PRICES.standalone[interval]
  } else {
    priceId = PRICES[plan as keyof typeof PRICES]?.[interval]
  }

  if (!priceId) {
    console.error('[create-trial] Invalid plan or price not configured:', plan, interval)
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  // Get or create Stripe customer
  const existingSub = await prisma.subscriptions.findFirst({
    where: { user_id: userId },
    select: { stripe_customer_id: true },
  })

  let customerId = existingSub?.stripe_customer_id ?? null
  if (!customerId) {
    const customer = await getStripe().customers.create({
      email: user.email,
      metadata: { userId },
    })
    customerId = customer.id
    console.log('[create-trial] Created Stripe customer:', customerId)
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const successUrl = `${origin}/clients?trial=started`
  const cancelUrl = `${origin}/pricing`

  console.log('[create-trial] Creating checkout with success URL:', successUrl)

  const sessionParams: Parameters<ReturnType<typeof getStripe>['checkout']['sessions']['create']>[0] = {
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    payment_method_collection: 'always',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { trial_period_days: 7 },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, plan, promoCode: promoCode || '' },
  }

  // Apply promo coupon if validated and env var is set
  if (promoCode && process.env.STRIPE_PROMO_COUPON_ID) {
    sessionParams.discounts = [{ coupon: process.env.STRIPE_PROMO_COUPON_ID }]
  }

  const session = await getStripe().checkout.sessions.create(sessionParams)
  console.log('[create-trial] Stripe checkout created:', session.id)

  const name = user.name || user.email.split('@')[0] || 'there'
  sendWelcomeEmail(user.email, name).catch(err => console.error('[create-trial] welcome email error:', err))

  return NextResponse.json({ url: session.url })
}
