import { NextResponse } from 'next/server'
import { getStripe, BCBA_STUDENTS_PRICES } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

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
