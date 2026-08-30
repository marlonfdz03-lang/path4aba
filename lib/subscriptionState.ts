// Shared subscription-state resolver + plan-change, used by all three checkout routes so there is ONE
// implementation of "does this customer already have a subscription for this product, and if so change the
// plan instead of minting a new one". The pure decision logic lives in lib/planMapping.ts (unit-tested);
// this file binds it to Stripe + the DB.

import { getStripe, PRICES, BCBA_STUDENTS_PRICES, PLAN_LIMITS } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { recordSubscriptionEvent } from '@/lib/subscriptionEvents'
import { emitAdminAlert } from '@/lib/adminAlerts'
import {
  buildPriceToPlan, planFromPriceId, planDirection, mapStripeStatus, resolveStateFromLister, type SubState,
} from '@/lib/planMapping'
import { subCurrentPeriodEnd, epochToDate } from '@/lib/stripeEventFields'

const PRICE_TO_PLAN = buildPriceToPlan(PRICES as any, BCBA_STUDENTS_PRICES as any)
const RESOLVE_TIMEOUT_MS = 10000

// All price ids for the PRIMARY products (RBT/BCBA) and for the bcba_students add-on. A route passes the set
// that defines "this product" so state is computed per product (a customer may hold both simultaneously).
export const PRIMARY_PRICE_IDS: string[] = Object.values(PRICES).flatMap((p) => [p.month, p.year]).filter(Boolean)
export const STUDENTS_PRICE_IDS: string[] = Object.values(BCBA_STUDENTS_PRICES).flatMap((p) => [p.month, p.year]).filter(Boolean)

// Resolve the customer's state for the given product price set. FAIL CLOSED via resolveStateFromLister.
export async function resolveSubscriptionState(
  customerId: string | null | undefined,
  relevantPriceIds: string[],
): Promise<SubState> {
  if (!customerId) return { state: 'none' } // no Stripe customer yet -> brand new, never subscribed
  const set = new Set(relevantPriceIds.filter(Boolean))
  return resolveStateFromLister(
    () => getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 }, { timeout: RESOLVE_TIMEOUT_MS } as any) as any,
    set,
    RESOLVE_TIMEOUT_MS,
  )
}

export interface ChangePlanResult { changed: boolean; unchanged?: boolean; plan?: string; localSynced?: boolean }

// Change the plan on an EXISTING subscription (never a new checkout). Equal price -> unchanged, no Stripe
// call. Otherwise direction by tier, falling back to amount for an equal-tier interval switch. SYNCHRONOUSLY
// writes the local subscriptions row from the object Stripe returns (the webhook's subscription.updated does
// NOT write `plan`, so without this the client keeps the old plan/limit indefinitely — Yuneisy's symptom).
export async function changePlan(params: {
  liveSub: any; itemId: string; newPriceId: string; newPlan: string; userId: string | null; customerId: string | null
}): Promise<ChangePlanResult> {
  const { liveSub, itemId, newPriceId, newPlan, userId, customerId } = params
  const currentItem = (liveSub?.items?.data || []).find((i: any) => i.id === itemId)
  const currentPriceId: string | null = currentItem?.price?.id ?? null
  const oldPlan = planFromPriceId(currentPriceId, PRICE_TO_PLAN)

  // Equal price -> nothing to do. No Stripe call, no plan.changed row (the caller returns { unchanged }).
  if (currentPriceId && currentPriceId === newPriceId) {
    return { changed: false, unchanged: true, plan: oldPlan ?? undefined }
  }

  const oldTier = PLAN_LIMITS[(oldPlan ?? '') as keyof typeof PLAN_LIMITS] ?? 0
  const newTier = PLAN_LIMITS[newPlan as keyof typeof PLAN_LIMITS] ?? 0
  const oldInterval: string | null = currentItem?.price?.recurring?.interval ?? null
  const oldAmount: number = currentItem?.price?.unit_amount ?? 0

  // Amount is only needed to break an equal-tier tie (interval switch) -> fetch the new price only then.
  let newAmount = 0
  let newInterval: string | null = null
  if (oldTier === newTier) {
    try {
      const np: any = await getStripe().prices.retrieve(newPriceId)
      newAmount = np?.unit_amount ?? 0
      newInterval = np?.recurring?.interval ?? null
    } catch { /* leave newAmount 0; direction falls to 'downgrade' at worst, still a valid switch */ }
  }
  const direction = planDirection(oldTier, newTier, oldAmount, newAmount)
  const proration = direction === 'upgrade' ? 'create_prorations' : 'none'

  // Stripe is the source of truth. If this throws, the caller returns an error and NOTHING local changed.
  const updated: any = await getStripe().subscriptions.update(liveSub.id, {
    items: [{ id: itemId, price: newPriceId }],
    proration_behavior: proration as any,
  })

  const newStatus = mapStripeStatus(updated.status)
  // current_period_end moved to the subscription item in Basil (we are on dahlia); read via the helper
  // (per-item first, top-level fallback) and route through epochToDate so a missing field is null, never
  // new Date(NaN).
  const periodEnd = epochToDate(subCurrentPeriodEnd(updated))
  // trial_end did not move in Basil, but the no-new-Date(x*1000) rule holds without exception.
  const trialEnd = updated.status === 'trialing' ? epochToDate(updated.trial_end) : null

  // SYNCHRONOUS local write — see the doc comment above.
  let localSynced = true
  try {
    await prisma.subscriptions.updateMany({
      where: { stripe_subscription_id: liveSub.id },
      data: {
        plan: newPlan,
        status: newStatus,
        ...(periodEnd ? { current_period_ends_at: periodEnd } : {}),
        ...(trialEnd ? { trial_ends_at: trialEnd } : {}),
      },
    })
  } catch (e: any) {
    // Stripe changed but our row didn't — a divergence the webhook's plan backstop will heal, but it MUST be
    // visible now (until it heals the user could see the old limit). Fail-soft: never rethrow.
    localSynced = false
    await emitAdminAlert({
      source: 'system', type: 'billing.local_sync_failed', severity: 'critical', actorUserId: userId ?? null,
      payload: { subscription_id: liveSub.id, intended_plan: newPlan, error: e?.message || String(e) },
    })
  }

  const intervalChange = !!(oldInterval && newInterval && oldInterval !== newInterval)
  await recordSubscriptionEvent({
    userId, customerId, subscriptionId: liveSub.id,
    eventType: 'plan.changed', source: 'update',
    oldPlan, newPlan, oldStatus: mapStripeStatus(liveSub.status), newStatus,
    oldSubscriptionId: liveSub.id, newSubscriptionId: liveSub.id, // same sub -> not an id replacement
    metadata: {
      direction, proration, interval_change: intervalChange,
      old_interval: oldInterval, new_interval: newInterval,
      old_price: currentPriceId, new_price: newPriceId, local_synced: localSynced,
    },
  })

  return { changed: true, plan: newPlan, localSynced }
}
