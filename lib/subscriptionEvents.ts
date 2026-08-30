// Append-only writer for the subscription_events audit log. FAIL-SOFT BY CONTRACT — exactly like
// emitAdminAlert: it never throws and never blocks its caller. It is invoked from the Stripe webhook, where
// a thrown error would 500 the response and make Stripe RETRY the event, re-running the mutation (duplicate
// charges/state). So a failed history write must be swallowed with a log line, never propagated. prisma is
// imported lazily (not at module load) so the pure predicate below is testable in bare node.

export interface SubscriptionEventInput {
  userId?: string | null
  customerId?: string | null
  subscriptionId?: string | null
  eventType: string
  source: string
  stripeEventId?: string | null
  oldPlan?: string | null
  newPlan?: string | null
  oldStatus?: string | null
  newStatus?: string | null
  oldSubscriptionId?: string | null
  newSubscriptionId?: string | null
  metadata?: Record<string, unknown> | null
}

// PURE: fire the billing.subscription_id_replaced alert ONLY when an existing non-null subscription id is
// being overwritten with a DIFFERENT non-null id. Not on first write (old null), not on the same id, not
// when the new id is null. Zero imports — unit-tested.
export function shouldAlertIdReplaced(
  oldId: string | null | undefined,
  newId: string | null | undefined,
): boolean {
  return !!oldId && !!newId && oldId !== newId
}

// Record one subscription-change event. Never throws (see contract above).
export async function recordSubscriptionEvent(input: SubscriptionEventInput): Promise<void> {
  try {
    const { prisma } = await import('@/lib/prisma')
    await prisma.subscription_events.create({
      data: {
        user_id: input.userId ?? null,
        stripe_customer_id: input.customerId ?? null,
        stripe_subscription_id: input.subscriptionId ?? null,
        event_type: input.eventType,
        source: input.source,
        stripe_event_id: input.stripeEventId ?? null,
        old_plan: input.oldPlan ?? null,
        new_plan: input.newPlan ?? null,
        old_status: input.oldStatus ?? null,
        new_status: input.newStatus ?? null,
        old_subscription_id: input.oldSubscriptionId ?? null,
        new_subscription_id: input.newSubscriptionId ?? null,
        metadata: (input.metadata ?? undefined) as never,
      },
    })
  } catch (e) {
    // Swallow — an audit-log failure must never turn a good webhook into a 500 (which Stripe would retry).
    console.error(`[subscription-events] failed to record "${input.eventType}":`, (e as Error)?.message ?? e)
  }
}
