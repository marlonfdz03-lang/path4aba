import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getStripe, PRICES, BCBA_STUDENTS_PRICES } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { sendWelcomeEmail } from '@/lib/email'

export async function POST(request: Request) {
  // SECURITY: always get userId from server session, never trust client
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id as string

  let body: { plan?: string; interval?: string; promoCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { plan, promoCode } = body
  const interval = (body.interval === 'year' ? 'year' : 'month') as 'month' | 'year'

  console.log('[create-trial] request:', { userId, plan })

  if (!plan) {
    return NextResponse.json({ error: 'Missing plan' }, { status: 400 })
  }

  // Verify user exists
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true } })
  if (!user) {
    console.error('[create-trial] User not found:', userId)
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Cross-check plan key against the user's role in the DB
  const role = user.role || ''
  const RBT_PLANS      = ['rbt_1', 'rbt_2']
  const BCBA_PLANS     = ['bcba_starter', 'bcba_pro']
  const STUDENT_PLANS  = ['bcba_students_standalone', 'bcba_students_addon']

  const isRbt     = ['rbt'].includes(role)
  const isBcba    = ['bcba', 'bcaba'].includes(role)
  const isStudent = ['bcba_student', 'bcaba_student'].includes(role)
  const isAdmin   = role === 'admin'

  const planAllowed =
    isAdmin ||
    (isRbt     && RBT_PLANS.includes(plan))             ||
    (isRbt     && plan === 'bcba_students_addon')        ||
    (isBcba    && BCBA_PLANS.includes(plan))             ||
    (isStudent && STUDENT_PLANS.includes(plan))

  if (!planAllowed) {
    console.error('[create-trial] Plan/role mismatch:', { plan, role, userId })
    return NextResponse.json({ error: 'This plan is not available for your account type.' }, { status: 403 })
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
