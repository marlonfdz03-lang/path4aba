/**
 * Pure, bare-node-testable core of the Stripe webhook LOUD-FAILURE CONTRACT.
 *
 * No `@/` imports and no Stripe SDK, so this runs under `node --test`. route.ts binds these to the real
 * emitAdminAlert + Stripe event types; the decision logic and the 500-is-guaranteed property live here where
 * they can be asserted directly.
 *
 * The contract: an event that IS ours but cannot be persisted returns 500 (Stripe retries the idempotent
 * event, the endpoint error rate reflects it); an event that is NOT ours stays 200 and silent. The alert is
 * layered observability — safeEmit below guarantees the 500 is returned even if the emitter throws, so
 * Stripe's retry never depends on the observability write succeeding.
 */

export type AlertEmitter = (input: {
  source: 'system'
  type: 'billing.webhook_field_missing' | 'billing.webhook_write_failed'
  severity: 'critical'
  payload: Record<string, unknown>
}) => Promise<void>

type EventRef = { id: string; type: string }
type Ids = { subscriptionId?: string | null; customerId?: string | null; billingReason?: string | null }

// Is this invoice tied to a subscription? Distinguishes "we should have found a subscription id and didn't"
// (a resolution failure to shout about) from "a one-off invoice legitimately has no subscription" (not ours).
export function isSubscriptionInvoice(invoice: any): boolean {
  const reason = invoice?.billing_reason
  return (typeof reason === 'string' && reason.startsWith('subscription')) ||
    invoice?.parent?.type === 'subscription_details'
}

// Call the emitter but NEVER let it throw — the 500 must be returned regardless of the alert's fate (the DB
// outage that failed the write will also fail the alert write; Stripe must still get its 500 and retry).
async function safeEmit(emit: AlertEmitter, input: Parameters<AlertEmitter>[0]): Promise<void> {
  try {
    await emit(input)
  } catch (e) {
    try {
      console.error('[webhook] alert emit failed (500 still returned):', (e as Error)?.message ?? e)
    } catch {
      /* noop — even logging must not break the 500 path */
    }
  }
}

// A required field could not be resolved for an event that is ours. Alert (safely) + 500.
export async function fieldMissingResponse(
  emit: AlertEmitter, event: EventRef, field: string, ids: Ids,
): Promise<Response> {
  await safeEmit(emit, {
    source: 'system', type: 'billing.webhook_field_missing', severity: 'critical',
    payload: {
      event_id: event.id, event_type: event.type, field,
      subscription_id: ids.subscriptionId ?? null, customer_id: ids.customerId ?? null,
      billing_reason: ids.billingReason ?? null,
    },
  })
  return new Response('Unresolved field: ' + field, { status: 500 })
}

// A DB write inside the handler threw. Alert (safely) + 500 so Stripe redelivers the idempotent event.
export async function writeFailedResponse(
  emit: AlertEmitter, event: EventRef, err: unknown, ids: Ids,
): Promise<Response> {
  await safeEmit(emit, {
    source: 'system', type: 'billing.webhook_write_failed', severity: 'critical',
    payload: {
      event_id: event.id, event_type: event.type,
      subscription_id: ids.subscriptionId ?? null, customer_id: ids.customerId ?? null,
      error: (err as Error)?.message ?? String(err),
    },
  })
  return new Response('Write failed', { status: 500 })
}
