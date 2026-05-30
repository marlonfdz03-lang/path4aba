import { NextResponse } from 'next/server'
import { getStripe, PRICES } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { sendWelcomeEmail } from '@/lib/email'

export async function POST(request: Request) {
  let body: { userId?: string; plan?: string; promoCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { userId, plan, promoCode } = body

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

  // Monthly pricing for trial signup — user can switch interval later via billing portal
  const priceId = PRICES[plan as keyof typeof PRICES]?.['month']
  if (!priceId) {
    console.error('[create-trial] Invalid plan:', plan)
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

  const successUrl = 'https://path4aba-git-main-marlonfdz03-langs-projects.vercel.app/dashboard?trial=started'
  const cancelUrl = 'https://path4aba-git-main-marlonfdz03-langs-projects.vercel.app/onboarding'

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
