import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const { userId } = await request.json()

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const sub = await prisma.subscriptions.findFirst({
    where: { user_id: userId },
    select: { stripe_customer_id: true },
  })

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 })
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const session = await getStripe().billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${origin}/billing`,
  })

  return NextResponse.json({ url: session.url })
}
