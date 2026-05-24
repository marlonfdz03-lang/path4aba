import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { supabaseServer } from '@/lib/supabaseServer'
import { sendPaymentConfirmationEmail, sendPaymentFailedEmail } from '@/lib/email'
import Stripe from 'stripe'

// Required so Next.js doesn't cache this route or pre-read the body
export const dynamic = 'force-dynamic'

function mapStripeStatus(status: string): 'active' | 'trialing' | 'canceled' | 'expired' {
  if (status === 'active') return 'active'
  if (status === 'trialing') return 'trialing'
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled'
  return 'expired'
}

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('Stripe webhook verification failed:', err)
    return NextResponse.json({ error: 'Webhook signature invalid' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.userId
      const plan = session.metadata?.plan || 'rbt'

      if (!userId || !session.subscription) {
        console.error('Missing userId or subscription in checkout.session.completed', { userId, subscription: session.subscription })
        break
      }

      const subscription = await getStripe().subscriptions.retrieve(session.subscription as string)
      const periodEnd = new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000).toISOString()
      
      // Determine status based on Stripe subscription status (trialing vs active)
      const subscriptionStatus = subscription.status === 'trialing' ? 'trialing' : 'active'
      
      // Calculate trial end date if in trial period
      let trialEndsAt: string | null = null
      if (subscription.status === 'trialing' && (subscription as unknown as { trial_end: number }).trial_end) {
        trialEndsAt = new Date((subscription as unknown as { trial_end: number }).trial_end * 1000).toISOString()
      }

      const update = {
        plan,
        status: subscriptionStatus,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        current_period_ends_at: periodEnd,
        trial_ends_at: trialEndsAt,
      }

      const { data: existing } = await supabaseServer
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()

      if (existing) {
        await supabaseServer.from('subscriptions').update(update).eq('user_id', userId)
      } else {
        await supabaseServer.from('subscriptions').insert({ ...update, user_id: userId })
      }

      // Increment promo code usage if one was applied (atomic via DB function)
      const appliedPromo = session.metadata?.promoCode
      if (appliedPromo) {
        await supabaseServer.rpc('increment_promo_uses', { promo_code: appliedPromo })
      }

      // Send payment confirmation email
      if (userId) {
        supabaseServer.auth.admin.getUserById(userId).then(({ data }) => {
          const u = data.user
          if (!u?.email) return
          const name = u.user_metadata?.full_name || u.email.split('@')[0] || 'there'
          const planLabel = (plan || 'rbt').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          sendPaymentConfirmationEmail(u.email, name, planLabel, '—').catch(
            err => console.error('[webhook] payment confirmation email error:', err)
          )
        }).catch(err => console.error('[webhook] user lookup error:', err))
      }

      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const periodEnd = new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000).toISOString()
      
      // Calculate trial end date if in trial period
      let trialEndsAt: string | null = null
      if (subscription.status === 'trialing' && (subscription as unknown as { trial_end: number }).trial_end) {
        trialEndsAt = new Date((subscription as unknown as { trial_end: number }).trial_end * 1000).toISOString()
      }

      const update: any = {
        status: mapStripeStatus(subscription.status),
        current_period_ends_at: periodEnd,
      }
      
      if (trialEndsAt) {
        update.trial_ends_at = trialEndsAt
      }

      await supabaseServer
        .from('subscriptions')
        .update(update)
        .eq('stripe_subscription_id', subscription.id)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription

      await supabaseServer
        .from('subscriptions')
        .update({ status: 'canceled' })
        .eq('stripe_subscription_id', subscription.id)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerEmail = (invoice as any).customer_email as string | null
      const customerId = invoice.customer as string | null

      ;(async () => {
        try {
          let email = customerEmail
          let name = email ? email.split('@')[0] : 'there'

          if (!email && customerId) {
            const { data: sub } = await supabaseServer
              .from('subscriptions')
              .select('user_id')
              .eq('stripe_customer_id', customerId)
              .maybeSingle()
            if (sub?.user_id) {
              const { data } = await supabaseServer.auth.admin.getUserById(sub.user_id)
              const u = data?.user
              if (u?.email) {
                email = u.email
                name = u.user_metadata?.full_name || u.email.split('@')[0] || 'there'
              }
            }
          }

          if (email) await sendPaymentFailedEmail(email, name)
        } catch (err) {
          console.error('[webhook] payment failed email error:', err)
        }
      })()
      break
    }
  }

  return NextResponse.json({ received: true })
}
