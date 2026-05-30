import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { sendPaymentConfirmationEmail, sendPaymentFailedEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
})

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

        if (plan === 'bcba_students') {
          try {
            await prisma.subscriptions.upsert({
              where: { user_id: userId },
              create: {
                user_id: userId,
                bcba_students_status: 'trialing',
                bcba_students_trial_ends_at: trialEnd,
                bcba_students_subscription_id: session.subscription?.toString() || null,
                stripe_customer_id: session.customer?.toString() || null,
              },
              update: {
                bcba_students_status: 'trialing',
                bcba_students_trial_ends_at: trialEnd,
                bcba_students_subscription_id: session.subscription?.toString() || null,
                stripe_customer_id: session.customer?.toString() || null,
              },
            })
            console.log('[webhook] bcba_students subscription saved for:', userId)
          } catch (err: any) {
            console.error('[webhook] bcba_students upsert error:', err.message)
            return new Response('DB error: ' + err.message, { status: 500 })
          }
        } else {
          try {
            await prisma.subscriptions.upsert({
              where: { user_id: userId },
              create: {
                user_id: userId,
                plan,
                status: 'trialing',
                trial_ends_at: trialEnd,
                stripe_customer_id: session.customer?.toString() || null,
                stripe_subscription_id: session.subscription?.toString() || null,
              },
              update: {
                plan,
                status: 'trialing',
                trial_ends_at: trialEnd,
                stripe_customer_id: session.customer?.toString() || null,
                stripe_subscription_id: session.subscription?.toString() || null,
              },
            })
            console.log('Subscription saved for:', userId)
          } catch (err: any) {
            console.error('Prisma upsert error:', err.message)
            return new Response('DB error: ' + err.message, { status: 500 })
          }

          // Increment promo code usage if one was applied
          const appliedPromo = session.metadata?.promoCode
          if (appliedPromo) {
            await prisma.promo_codes.updateMany({
              where: { code: appliedPromo },
              data: { current_uses: { increment: 1 } },
            }).catch(err => console.error('[webhook] promo increment error:', err))
          }
        }

        // Send payment confirmation email (fire-and-forget)
        prisma.users.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        }).then((u) => {
          if (!u?.email) return
          const name = u.name || u.email.split('@')[0] || 'there'
          const planLabel = plan.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          sendPaymentConfirmationEmail(u.email, name, planLabel, '—').catch(
            (err) => console.error('[webhook] payment confirmation email error:', err)
          )
        }).catch((err) => console.error('[webhook] user lookup error:', err))

        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const periodEnd = new Date((subscription as any).current_period_end * 1000)
        const mappedStatus = mapStripeStatus(subscription.status)

        // Try updating as bcba_students subscription first
        const bcbaRow = await prisma.subscriptions.findFirst({
          where: { bcba_students_subscription_id: subscription.id },
          select: { user_id: true },
        })

        if (bcbaRow) {
          const updateData: any = { bcba_students_status: mappedStatus }
          if (subscription.status === 'trialing' && (subscription as any).trial_end) {
            updateData.bcba_students_trial_ends_at = new Date((subscription as any).trial_end * 1000)
          }
          await prisma.subscriptions.updateMany({
            where: { bcba_students_subscription_id: subscription.id },
            data: updateData,
          }).catch(err => console.error('[webhook] bcba_students subscription.updated error:', err))
        } else {
          const updateData: any = { status: mappedStatus, current_period_ends_at: periodEnd }
          if (subscription.status === 'trialing' && (subscription as any).trial_end) {
            updateData.trial_ends_at = new Date((subscription as any).trial_end * 1000)
          }
          await prisma.subscriptions.updateMany({
            where: { stripe_subscription_id: subscription.id },
            data: updateData,
          }).catch(err => console.error('[webhook] subscription.updated error:', err))
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        // Try bcba_students first
        const bcbaRow = await prisma.subscriptions.findFirst({
          where: { bcba_students_subscription_id: subscription.id },
          select: { user_id: true },
        })

        if (bcbaRow) {
          await prisma.subscriptions.updateMany({
            where: { bcba_students_subscription_id: subscription.id },
            data: { bcba_students_status: 'canceled' },
          }).catch(err => console.error('[webhook] bcba_students subscription.deleted error:', err))
        } else {
          await prisma.subscriptions.updateMany({
            where: { stripe_subscription_id: subscription.id },
            data: { status: 'canceled' },
          }).catch(err => console.error('[webhook] subscription.deleted error:', err))
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
              const sub = await prisma.subscriptions.findFirst({
                where: { stripe_customer_id: customerId },
                select: { user_id: true },
              })
              if (sub?.user_id) {
                const u = await prisma.users.findUnique({
                  where: { id: sub.user_id },
                  select: { email: true, name: true },
                })
                if (u?.email) {
                  email = u.email
                  name = u.name || u.email.split('@')[0] || 'there'
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
