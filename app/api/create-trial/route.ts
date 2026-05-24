import { NextResponse } from 'next/server'
import { getStripe, PRICES } from '@/lib/stripe'
import { supabaseServer } from '@/lib/supabaseServer'

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

  // Verify user exists in Supabase Auth
  const { data: { user }, error: userError } = await supabaseServer.auth.admin.getUserById(userId)
  if (userError || !user) {
    console.error('[create-trial] User not found:', userError?.message)
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Monthly pricing for trial signup — user can switch interval later via billing portal
  const priceId = PRICES[plan as keyof typeof PRICES]?.['month']
  if (!priceId) {
    console.error('[create-trial] Invalid plan:', plan)
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  // Get or create Stripe customer
  const { data: existingSub } = await supabaseServer
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()

  let customerId = existingSub?.stripe_customer_id ?? null
  if (!customerId) {
    const customer = await getStripe().customers.create({
      email: user.email,
      metadata: { userId },
    })
    customerId = customer.id
    console.log('[create-trial] Created Stripe customer:', customerId)
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  const sessionParams: Parameters<ReturnType<typeof getStripe>['checkout']['sessions']['create']>[0] = {
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    payment_method_collection: 'always',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { trial_period_days: 7 },
    success_url: `${origin}/dashboard?trial=started`,
    cancel_url: `${origin}/onboarding`,
    metadata: { userId, plan, promoCode: promoCode || '' },
  }

  // Apply promo coupon if validated and env var is set
  if (promoCode && process.env.STRIPE_PROMO_COUPON_ID) {
    sessionParams.discounts = [{ coupon: process.env.STRIPE_PROMO_COUPON_ID }]
  }

  const session = await getStripe().checkout.sessions.create(sessionParams)
  console.log('[create-trial] Stripe checkout created:', session.id)

  return NextResponse.json({ url: session.url })
}
