import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { sendPaymentConfirmationEmail, sendPaymentFailedEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
})

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function mapStripeStatus(status: string): 'active' | 'trialing' | 'canceled' | 'expired' {
  if (status === 'active') return 'active'
  if (status === 'trialing') return 'trialing'
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled'
  return 'expired'
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text()
    const sig = req.headers.get('stripe-signature')

    if (!sig) {
      return new Response('No signature', { status: 400 })
    }

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      )
    } catch (err: any) {
      console.error('Webhook signature error:', err.message)
      return new Response(`Signature error: ${err.message}`, { status: 400 })
    }

    console.log('Webhook event:', event.type)

    const supabase = getSupabase()

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        const userId = session.metadata?.userId || session.client_reference_id
        const plan = session.metadata?.plan || 'rbt'

        console.log('Processing checkout for userId:', userId, 'plan:', plan)

        if (!userId) {
          console.error('No userId found in session metadata')
          return new Response('No userId', { status: 200 })
        }

        const trialEnd = new Date()
        trialEnd.setDate(trialEnd.getDate() + 7)
        const trial_ends_at = trialEnd.toISOString()

        if (plan === 'bcba_students') {
          // Add-on: update bcba_students columns on existing row (or create row)
          const { error } = await supabase
            .from('subscriptions')
            .upsert({
              user_id: userId,
              bcba_students_status: 'trialing',
              bcba_students_trial_ends_at: trial_ends_at,
              bcba_students_subscription_id: session.subscription?.toString() || null,
              stripe_customer_id: session.customer?.toString() || null,
            }, { onConflict: 'user_id' })
          if (error) {
            console.error('[webhook] bcba_students upsert error:', JSON.stringify(error))
            return new Response('DB error: ' + error.message, { status: 500 })
          }
          console.log('[webhook] bcba_students subscription saved for:', userId)
        } else {
          const { error } = await supabase
            .from('subscriptions')
            .upsert({
              user_id: userId,
              plan,
              status: 'trialing',
              trial_ends_at,
              stripe_customer_id: session.customer?.toString() || null,
              stripe_subscription_id: session.subscription?.toString() || null,
            }, { onConflict: 'user_id' })

          if (error) {
            console.error('Supabase upsert error:', JSON.stringify(error))
            return new Response('DB error: ' + error.message, { status: 500 })
          }
          console.log('Subscription saved for:', userId)

          // Increment promo code usage if one was applied
          const appliedPromo = session.metadata?.promoCode
          if (appliedPromo) {
            await supabase.rpc('increment_promo_uses', { promo_code: appliedPromo })
          }
        }

        // Send payment confirmation email (fire-and-forget)
        supabase.auth.admin.getUserById(userId).then(({ data }) => {
          const u = data.user
          if (!u?.email) return
          const name = u.user_metadata?.full_name || u.email.split('@')[0] || 'there'
          const planLabel = plan.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          sendPaymentConfirmationEmail(u.email, name, planLabel, '—').catch(
            (err) => console.error('[webhook] payment confirmation email error:', err)
          )
        }).catch((err) => console.error('[webhook] user lookup error:', err))

        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const periodEnd = new Date((subscription as any).current_period_end * 1000).toISOString()
        const mappedStatus = mapStripeStatus(subscription.status)

        // Try updating as bcba_students subscription first
        const { data: bcbaRow } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('bcba_students_subscription_id', subscription.id)
          .maybeSingle()

        if (bcbaRow) {
          const update: any = { bcba_students_status: mappedStatus }
          if (subscription.status === 'trialing' && (subscription as any).trial_end) {
            update.bcba_students_trial_ends_at = new Date((subscription as any).trial_end * 1000).toISOString()
          }
          const { error } = await supabase
            .from('subscriptions')
            .update(update)
            .eq('bcba_students_subscription_id', subscription.id)
          if (error) console.error('[webhook] bcba_students subscription.updated error:', error)
        } else {
          const update: any = {
            status: mappedStatus,
            current_period_ends_at: periodEnd,
          }
          if (subscription.status === 'trialing' && (subscription as any).trial_end) {
            update.trial_ends_at = new Date((subscription as any).trial_end * 1000).toISOString()
          }
          const { error } = await supabase
            .from('subscriptions')
            .update(update)
            .eq('stripe_subscription_id', subscription.id)
          if (error) console.error('[webhook] subscription.updated error:', error)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        // Try bcba_students first
        const { data: bcbaRow } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('bcba_students_subscription_id', subscription.id)
          .maybeSingle()

        if (bcbaRow) {
          const { error } = await supabase
            .from('subscriptions')
            .update({ bcba_students_status: 'canceled' })
            .eq('bcba_students_subscription_id', subscription.id)
          if (error) console.error('[webhook] bcba_students subscription.deleted error:', error)
        } else {
          const { error } = await supabase
            .from('subscriptions')
            .update({ status: 'canceled' })
            .eq('stripe_subscription_id', subscription.id)
          if (error) console.error('[webhook] subscription.deleted error:', error)
        }
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
              const { data: sub } = await supabase
                .from('subscriptions')
                .select('user_id')
                .eq('stripe_customer_id', customerId)
                .maybeSingle()
              if (sub?.user_id) {
                const { data } = await supabase.auth.admin.getUserById(sub.user_id)
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

    return new Response('OK', { status: 200 })
  } catch (err: any) {
    console.error('Webhook crash:', err)
    return new Response('Server error: ' + err.message, { status: 500 })
  }
}
