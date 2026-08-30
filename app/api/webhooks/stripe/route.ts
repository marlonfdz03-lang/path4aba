import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { sendPaymentConfirmationEmail, sendPaymentFailedEmail } from '@/lib/email'
import { recordSubscriptionEvent, shouldAlertIdReplaced } from '@/lib/subscriptionEvents'
import { emitAdminAlert } from '@/lib/adminAlerts'
import { mapStripeStatus, buildPriceToPlan, planFromPriceId } from '@/lib/planMapping'
import { subCurrentPeriodEnd, invoiceSubscriptionId, epochToDate } from '@/lib/stripeEventFields'
import { isSubscriptionInvoice, fieldMissingResponse, writeFailedResponse } from '@/lib/webhookFailure'
import { PRICES, BCBA_STUDENTS_PRICES } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'stripe-key-required', {
  apiVersion: '2024-06-20' as any,
})

// priceId -> plan-key, so subscription.updated can write `plan` (the self-healing backstop for plan changes
// made in the Stripe Billing Portal, or the rare case changePlan's direct local write failed).
const PRICE_TO_PLAN = buildPriceToPlan(PRICES as any, BCBA_STUDENTS_PRICES as any)

// THE LOUD-FAILURE CONTRACT (pure core + tests in lib/webhookFailure.ts). An event that IS ours but whose
// required field cannot be resolved, or whose DB write throws, returns 500 — Stripe retries the idempotent
// event and the endpoint error rate finally reflects the failure. An event that is NOT ours (unknown type,
// non-subscription invoice, no matching local row) stays 200 and silent. The two *Response helpers wrap the
// alert so the 500 is returned even if the alert write itself fails.

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
            return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId: session.subscription?.toString() ?? null, customerId: session.customer?.toString() ?? null })
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
            return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId: session.subscription?.toString() ?? null, customerId: session.customer?.toString() ?? null })
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
        // current_period_end moved to the subscription item in Basil (we are on dahlia). Read via the
        // helper (per-item first, top-level fallback); epochToDate yields null (never Invalid Date) when
        // it cannot resolve, so we only write the column below when it actually resolved.
        const periodEnd = epochToDate(subCurrentPeriodEnd(subscription))
        const mappedStatus = mapStripeStatus(subscription.status)

        // Try updating as bcba_students subscription first (pre-read widened to capture old_* for the audit).
        const bcbaRow = await prisma.subscriptions.findFirst({
          where: { bcba_students_subscription_id: subscription.id },
          select: { user_id: true, bcba_students_status: true },
        })

        if (bcbaRow) {
          const updateData: any = { bcba_students_status: mappedStatus }
          // trial_end did not move in Basil, but the no-new-Date(x*1000) rule holds without exception.
          const bcbaTrialEnd = epochToDate((subscription as any).trial_end)
          if (subscription.status === 'trialing' && bcbaTrialEnd) {
            updateData.bcba_students_trial_ends_at = bcbaTrialEnd
          }
          try {
            await prisma.subscriptions.updateMany({
              where: { bcba_students_subscription_id: subscription.id },
              data: updateData,
            })
          } catch (err) {
            return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId: subscription.id, customerId: (subscription as any).customer })
          }
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
          // Resolution guard: this is our row, but the period did not resolve from any known path — fail
          // LOUD rather than write a half-update. (On dahlia the per-item read resolves; this only fires if
          // Stripe relocates the field again — the future-proof alarm.) Not-ours (rbtRow null) skips this
          // and the updateMany simply touches 0 rows -> 200 silent.
          if (rbtRow && periodEnd === null) {
            return await fieldMissingResponse(emitAdminAlert, event, 'current_period_end', { subscriptionId: subscription.id, customerId: (subscription as any).customer })
          }
          const updateData: any = { status: mappedStatus, ...(periodEnd ? { current_period_ends_at: periodEnd } : {}) }
          // trial_end did not move in Basil, but the no-new-Date(x*1000) rule holds without exception.
          const trialEnd = epochToDate((subscription as any).trial_end)
          if (subscription.status === 'trialing' && trialEnd) {
            updateData.trial_ends_at = trialEnd
          }
          // SELF-HEALING BACKSTOP: derive plan from the subscription's price id and write it. Historically
          // this handler never wrote `plan`, so a plan change made in the Stripe Portal (or a changePlan whose
          // direct local write failed) left our `plan`/limit stale forever. Only write when we recognize the
          // price (a primary RBT/BCBA plan); an unknown/students price leaves `plan` untouched.
          const derivedPlan = planFromPriceId((subscription as any).items?.data?.[0]?.price?.id, PRICE_TO_PLAN)
          if (derivedPlan && derivedPlan !== 'bcba_students') updateData.plan = derivedPlan
          try {
            await prisma.subscriptions.updateMany({
              where: { stripe_subscription_id: subscription.id },
              data: updateData,
            })
          } catch (err) {
            return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId: subscription.id, customerId: (subscription as any).customer })
          }
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
          try {
            await prisma.subscriptions.updateMany({
              where: { bcba_students_subscription_id: subscription.id },
              data: { bcba_students_status: 'canceled' },
            })
          } catch (err) {
            return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId: subscription.id, customerId: (subscription as any).customer })
          }
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
          try {
            await prisma.subscriptions.updateMany({
              where: { stripe_subscription_id: subscription.id },
              data: { status: 'canceled' },
            })
          } catch (err) {
            return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId: subscription.id, customerId: (subscription as any).customer })
          }
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
        // invoice.subscription was removed in Basil (we are on dahlia); read via the helper
        // (parent.subscription_details.subscription first, top-level fallback).
        const subscriptionId = invoiceSubscriptionId(invoice)
        const customerId = (invoice as any).customer as string
        if (!subscriptionId) {
          // Subscription-related invoice with no resolvable sub id -> shape changed, fail LOUD. A one-off
          // (non-subscription) invoice legitimately has no sub id -> not ours, 200 silent.
          if (isSubscriptionInvoice(invoice)) {
            return await fieldMissingResponse(emitAdminAlert, event, 'invoice.subscription', { customerId, billingReason: (invoice as any).billing_reason })
          }
          break
        }

        // Invoice line period (this path did not move in Basil); route through epochToDate so the rule
        // holds without exception, falling back to +30d only when the line has no usable period.
        const currentPeriodEnd =
          epochToDate((invoice as any).lines?.data?.[0]?.period?.end) ??
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

        // Try by stripe_subscription_id first (select widened to capture old_* for the audit).
        const existingSub = await prisma.subscriptions.findFirst({
          where: { stripe_subscription_id: subscriptionId },
          select: { id: true, user_id: true, plan: true, status: true },
        })

        if (existingSub) {
          try {
            await prisma.subscriptions.update({
              where: { id: existingSub.id },
              data: { status: 'active', current_period_ends_at: currentPeriodEnd },
            })
          } catch (err) {
            return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId, customerId })
          }
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
            try {
              await prisma.subscriptions.update({
                where: { id: byCustomer.id },
                data: {
                  status: 'active',
                  current_period_ends_at: currentPeriodEnd,
                  stripe_subscription_id: subscriptionId,
                },
              })
            } catch (err) {
              return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId, customerId })
            }
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
        // invoice.subscription was removed in Basil (we are on dahlia); read via the helper.
        const subscriptionId = invoiceSubscriptionId(invoice)
        const customerEmail = (invoice as any).customer_email as string | null
        const customerId = invoice.customer as string | null

        // Resolution guard: a subscription-related failure we cannot attribute must be loud, not silently
        // skipped. A non-subscription invoice legitimately has no sub id -> not ours, 200 silent.
        if (!subscriptionId) {
          if (isSubscriptionInvoice(invoice)) {
            return await fieldMissingResponse(emitAdminAlert, event, 'invoice.subscription', { customerId, billingReason: (invoice as any).billing_reason })
          }
          break
        }

        // Pre-read (site 11) to capture old_status AND decide ownership.
        const failRow = await prisma.subscriptions.findFirst({
          where: { stripe_subscription_id: subscriptionId },
          select: { user_id: true, status: true },
        })
        // Not ours (no local row) -> 200 silent: no write, and (option b) no email.
        if (!failRow) break

        try {
          await prisma.subscriptions.updateMany({
            where: { stripe_subscription_id: subscriptionId },
            data: { status: 'canceled' },
          })
        } catch (err) {
          return await writeFailedResponse(emitAdminAlert, event, err, { subscriptionId, customerId })
        }
        // AUDIT (fail-soft): site 11.
        await recordSubscriptionEvent({
          userId: failRow.user_id, customerId, subscriptionId,
          eventType: 'invoice.payment_failed', source: 'webhook', stripeEventId: event.id,
          oldStatus: failRow.status ?? null, newStatus: 'canceled',
        })
        console.log('[webhook] invoice.payment_failed — marked canceled for subscription:', subscriptionId)

        // Email option (b): fire-and-forget, but ONLY after the status write SUCCEEDED and ONLY for a matched
        // (ours) row. A retry re-sends nothing — a prior write failure 500'd before reaching here, and a
        // not-ours event returned above — so a just-declined user gets exactly one email, never a duplicate.
        ;(async () => {
          try {
            let email = customerEmail
            let name = email ? email.split('@')[0] : 'there'
            if (!email) {
              const u = await prisma.users.findUnique({
                where: { id: failRow.user_id },
                select: { email: true, name: true },
              })
              if (u?.email) {
                email = u.email
                name = u.name || u.email.split('@')[0] || 'there'
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
