import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { sendPaymentConfirmationEmail, sendPaymentFailedEmail } from '@/lib/email'
import { recordSubscriptionEvent, shouldAlertIdReplaced } from '@/lib/subscriptionEvents'
import { emitAdminAlert } from '@/lib/adminAlerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'stripe-key-required', {
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

        // Verify user exists — retry once after 2s if not found (race condition with registration)
        let userExists = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } })
        if (!userExists) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          userExists = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } })
        }
        if (!userExists) {
          console.error('[webhook] User not found for userId:', userId)
          return new Response('User not found', { status: 200 })
        }

        const trialEnd = new Date()
        trialEnd.setDate(trialEnd.getDate() + 7)

        if (plan === 'bcba_students') {
          try {
            const existingBcbaSub = await prisma.subscriptions.findFirst({
              where: { user_id: userId },
            })
            if (existingBcbaSub) {
              await prisma.subscriptions.update({
                where: { id: existingBcbaSub.id },
                data: {
                  bcba_students_status: 'trialing',
                  bcba_students_trial_ends_at: trialEnd,
                  bcba_students_subscription_id: session.subscription?.toString() || null,
                  stripe_customer_id: session.customer?.toString() || null,
                },
              })
            } else {
              await prisma.subscriptions.create({
                data: {
                  user_id: userId,
                  bcba_students_status: 'trialing',
                  bcba_students_trial_ends_at: trialEnd,
                  bcba_students_subscription_id: session.subscription?.toString() || null,
                  stripe_customer_id: session.customer?.toString() || null,
                },
              })
            }
            // AUDIT (fail-soft): sites 1/2. Old from existingBcbaSub (null on create). Alert on id replacement.
            const newBcbaSubId = session.subscription?.toString() || null
            await recordSubscriptionEvent({
              userId, customerId: session.customer?.toString() || null, subscriptionId: newBcbaSubId,
              eventType: 'checkout.completed', source: 'webhook', stripeEventId: event.id,
              oldStatus: existingBcbaSub?.bcba_students_status ?? null, newStatus: 'trialing',
              oldSubscriptionId: existingBcbaSub?.bcba_students_subscription_id ?? null, newSubscriptionId: newBcbaSubId,
              metadata: { channel: 'bcba_students' },
            })
            if (shouldAlertIdReplaced(existingBcbaSub?.bcba_students_subscription_id, newBcbaSubId)) {
              await emitAdminAlert({ source: 'system', type: 'billing.subscription_id_replaced', severity: 'warning', actorUserId: userId, payload: { old_subscription_id: existingBcbaSub?.bcba_students_subscription_id, new_subscription_id: newBcbaSubId, event_type: 'checkout.completed', channel: 'bcba_students' } })
            }
            console.log('[webhook] bcba_students subscription saved for:', userId)
          } catch (err: any) {
            console.error('[webhook] bcba_students upsert error:', err.message)
            return new Response('DB error: ' + err.message, { status: 500 })
          }
        } else {
          try {
            const existingSub = await prisma.subscriptions.findFirst({
              where: { user_id: userId },
            })
            if (existingSub) {
              await prisma.subscriptions.update({
                where: { id: existingSub.id },
                data: {
                  plan,
                  status: 'trialing',
                  trial_ends_at: trialEnd,
                  stripe_customer_id: session.customer?.toString() || null,
                  stripe_subscription_id: session.subscription?.toString() || null,
                },
              })
            } else {
              await prisma.subscriptions.create({
                data: {
                  user_id: userId,
                  plan,
                  status: 'trialing',
                  trial_ends_at: trialEnd,
                  stripe_customer_id: session.customer?.toString() || null,
                  stripe_subscription_id: session.subscription?.toString() || null,
                },
              })
            }
            // AUDIT (fail-soft): sites 3/4 — the plan-change + id-replacement site (the yunymntz78 catcher).
            // Old from existingSub (full row; null on create). Alert when the old sub id is replaced by a new one.
            const newSubId = session.subscription?.toString() || null
            await recordSubscriptionEvent({
              userId, customerId: session.customer?.toString() || null, subscriptionId: newSubId,
              eventType: 'checkout.completed', source: 'webhook', stripeEventId: event.id,
              oldPlan: existingSub?.plan ?? null, newPlan: plan,
              oldStatus: existingSub?.status ?? null, newStatus: 'trialing',
              oldSubscriptionId: existingSub?.stripe_subscription_id ?? null, newSubscriptionId: newSubId,
            })
            if (shouldAlertIdReplaced(existingSub?.stripe_subscription_id, newSubId)) {
              await emitAdminAlert({ source: 'system', type: 'billing.subscription_id_replaced', severity: 'warning', actorUserId: userId, payload: { old_subscription_id: existingSub?.stripe_subscription_id, new_subscription_id: newSubId, event_type: 'checkout.completed', old_plan: existingSub?.plan ?? null, new_plan: plan } })
            }
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

        // Try updating as bcba_students subscription first (pre-read widened to capture old_* for the audit).
        const bcbaRow = await prisma.subscriptions.findFirst({
          where: { bcba_students_subscription_id: subscription.id },
          select: { user_id: true, bcba_students_status: true },
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
          // AUDIT (fail-soft): site 5 — status transition only, no id replacement.
          await recordSubscriptionEvent({
            userId: bcbaRow.user_id, subscriptionId: subscription.id,
            eventType: 'subscription.updated', source: 'webhook', stripeEventId: event.id,
            oldStatus: bcbaRow.bcba_students_status ?? null, newStatus: mappedStatus,
            metadata: { channel: 'bcba_students' },
          })
        } else {
          // Pre-read (site 6) to capture old_* before the updateMany, so each history row is self-describing.
          const rbtRow = await prisma.subscriptions.findFirst({
            where: { stripe_subscription_id: subscription.id },
            select: { user_id: true, plan: true, status: true },
          })
          const updateData: any = { status: mappedStatus, current_period_ends_at: periodEnd }
          if (subscription.status === 'trialing' && (subscription as any).trial_end) {
            updateData.trial_ends_at = new Date((subscription as any).trial_end * 1000)
          }
          await prisma.subscriptions.updateMany({
            where: { stripe_subscription_id: subscription.id },
            data: updateData,
          }).catch(err => console.error('[webhook] subscription.updated error:', err))
          // AUDIT (fail-soft): site 6 — status/period transition only, no id replacement.
          await recordSubscriptionEvent({
            userId: rbtRow?.user_id ?? null, subscriptionId: subscription.id,
            eventType: 'subscription.updated', source: 'webhook', stripeEventId: event.id,
            oldPlan: rbtRow?.plan ?? null, newPlan: rbtRow?.plan ?? null,
            oldStatus: rbtRow?.status ?? null, newStatus: mappedStatus,
          })
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        // Try bcba_students first (pre-read widened to capture old_status for the audit).
        const bcbaRow = await prisma.subscriptions.findFirst({
          where: { bcba_students_subscription_id: subscription.id },
          select: { user_id: true, bcba_students_status: true },
        })

        if (bcbaRow) {
          await prisma.subscriptions.updateMany({
            where: { bcba_students_subscription_id: subscription.id },
            data: { bcba_students_status: 'canceled' },
          }).catch(err => console.error('[webhook] bcba_students subscription.deleted error:', err))
          // AUDIT (fail-soft): site 7.
          await recordSubscriptionEvent({
            userId: bcbaRow.user_id, subscriptionId: subscription.id,
            eventType: 'subscription.deleted', source: 'webhook', stripeEventId: event.id,
            oldStatus: bcbaRow.bcba_students_status ?? null, newStatus: 'canceled',
            metadata: { channel: 'bcba_students' },
          })
        } else {
          // Pre-read (site 8) to capture old_status before the updateMany.
          const rbtRow = await prisma.subscriptions.findFirst({
            where: { stripe_subscription_id: subscription.id },
            select: { user_id: true, status: true },
          })
          await prisma.subscriptions.updateMany({
            where: { stripe_subscription_id: subscription.id },
            data: { status: 'canceled' },
          }).catch(err => console.error('[webhook] subscription.deleted error:', err))
          // AUDIT (fail-soft): site 8.
          await recordSubscriptionEvent({
            userId: rbtRow?.user_id ?? null, subscriptionId: subscription.id,
            eventType: 'subscription.deleted', source: 'webhook', stripeEventId: event.id,
            oldStatus: rbtRow?.status ?? null, newStatus: 'canceled',
          })
        }
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = (invoice as any).subscription as string
        const customerId = (invoice as any).customer as string
        if (!subscriptionId) break

        const periodEnd = (invoice as any).lines?.data?.[0]?.period?.end
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

        // Try by stripe_subscription_id first (select widened to capture old_* for the audit).
        const existingSub = await prisma.subscriptions.findFirst({
          where: { stripe_subscription_id: subscriptionId },
          select: { id: true, user_id: true, plan: true, status: true },
        })

        if (existingSub) {
          await prisma.subscriptions.update({
            where: { id: existingSub.id },
            data: { status: 'active', current_period_ends_at: currentPeriodEnd },
          })
          // AUDIT (fail-soft): site 9 — status transition only (id unchanged), no replacement alert.
          await recordSubscriptionEvent({
            userId: existingSub.user_id, customerId, subscriptionId,
            eventType: 'invoice.paid', source: 'webhook', stripeEventId: event.id,
            oldStatus: existingSub.status ?? null, newStatus: 'active',
          })
          console.log('[webhook] invoice.paid — marked active by subscription_id:', subscriptionId)
        } else {
          // Fallback: try by stripe_customer_id (select WIDENED to include stripe_subscription_id so we can
          // record old_* and detect a replacement — this branch SETS stripe_subscription_id).
          const byCustomer = await prisma.subscriptions.findFirst({
            where: { stripe_customer_id: customerId },
            select: { id: true, user_id: true, plan: true, status: true, stripe_subscription_id: true },
          })
          if (byCustomer) {
            await prisma.subscriptions.update({
              where: { id: byCustomer.id },
              data: {
                status: 'active',
                current_period_ends_at: currentPeriodEnd,
                stripe_subscription_id: subscriptionId,
              },
            })
            // AUDIT (fail-soft): site 10 — sets stripe_subscription_id. Alert only if it REPLACED a different id.
            await recordSubscriptionEvent({
              userId: byCustomer.user_id, customerId, subscriptionId,
              eventType: 'invoice.paid', source: 'webhook', stripeEventId: event.id,
              oldStatus: byCustomer.status ?? null, newStatus: 'active',
              oldSubscriptionId: byCustomer.stripe_subscription_id ?? null, newSubscriptionId: subscriptionId,
            })
            if (shouldAlertIdReplaced(byCustomer.stripe_subscription_id, subscriptionId)) {
              await emitAdminAlert({ source: 'system', type: 'billing.subscription_id_replaced', severity: 'warning', actorUserId: byCustomer.user_id, payload: { old_subscription_id: byCustomer.stripe_subscription_id, new_subscription_id: subscriptionId, event_type: 'invoice.paid' } })
            }
            console.log('[webhook] invoice.paid — marked active by customer_id:', customerId)
          } else {
            console.error('[webhook] invoice.paid — no subscription found for:', subscriptionId, customerId)
          }
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = (invoice as any).subscription as string
        const customerEmail = (invoice as any).customer_email as string | null
        const customerId = invoice.customer as string | null

        if (subscriptionId) {
          // Pre-read (site 11) to capture old_status before the updateMany.
          const failRow = await prisma.subscriptions.findFirst({
            where: { stripe_subscription_id: subscriptionId },
            select: { user_id: true, status: true },
          })
          await prisma.subscriptions.updateMany({
            where: { stripe_subscription_id: subscriptionId },
            data: { status: 'canceled' },
          }).catch(err => console.error('[webhook] invoice.payment_failed status error:', err))
          // AUDIT (fail-soft): site 11.
          await recordSubscriptionEvent({
            userId: failRow?.user_id ?? null, customerId, subscriptionId,
            eventType: 'invoice.payment_failed', source: 'webhook', stripeEventId: event.id,
            oldStatus: failRow?.status ?? null, newStatus: 'canceled',
          })
          console.log('[webhook] invoice.payment_failed — marked canceled for subscription:', subscriptionId)
        }

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
