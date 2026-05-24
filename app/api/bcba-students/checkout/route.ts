import { NextResponse } from 'next/server'
import { getStripe, BCBA_STUDENTS_PRICES } from '@/lib/stripe'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

const SUCCESS_URL = 'https://path4aba-git-main-marlonfdz03-langs-projects.vercel.app/bcba-students?trial=started'
const CANCEL_URL = 'https://path4aba-git-main-marlonfdz03-langs-projects.vercel.app/bcba-students'

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

  const { data: { user }, error: userError } = await supabaseServer.auth.admin.getUserById(userId)
  if (userError || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Check if user has an active RBT subscription → use addon price
  const { data: sub } = await supabaseServer
    .from('subscriptions')
    .select('status, plan, stripe_customer_id, trial_ends_at')
    .eq('user_id', userId)
    .maybeSingle()

  const now = new Date()
  const hasActiveRBT =
    sub?.plan === 'rbt' &&
    (sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) > now))

  const priceSet = hasActiveRBT ? BCBA_STUDENTS_PRICES.addon : BCBA_STUDENTS_PRICES.standalone
  const priceId = priceSet[interval]

  if (!priceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 })
  }

  // Reuse existing Stripe customer if one exists
  let customerId = sub?.stripe_customer_id ?? null
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
    subscription_data: { trial_period_days: 7 },
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    metadata: { userId, plan: 'bcba_students' },
  })

  return NextResponse.json({ url: session.url })
}
