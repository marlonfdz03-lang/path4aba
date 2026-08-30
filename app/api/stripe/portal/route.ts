import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST(_request: Request) {
  // userId comes ONLY from the authenticated session — never the request body. Trusting a body-supplied
  // userId let any caller open the Stripe Billing Portal (payment methods, invoices/PII, cancel) for ANY
  // customer by guessing an id — a billing account-takeover IDOR. A caller can only ever open their own.
  const authSession = await auth()
  if (!authSession?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (authSession.user as any).id as string

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
