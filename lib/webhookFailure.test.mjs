// Tests for the webhook loud-failure contract. Run with: npm test (node --test).
// The Stripe route itself can't be unit-tested in bare node (signature verification + `@/` imports), so the
// decision logic lives in lib/webhookFailure.ts and is asserted here. Mapping to the four boundary cases:
//   - not-ours event stays 200      -> isSubscriptionInvoice(oneOff) === false routes to the handler's `break`
//   - unresolvable field on ours    -> fieldMissingResponse(...) resolves to status 500
//   - a write failure               -> writeFailedResponse(...) resolves to status 500
//   - 500 still returns when emit throws -> both helpers still resolve to 500 with a throwing emitter
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSubscriptionInvoice, fieldMissingResponse, writeFailedResponse } from './webhookFailure.ts';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/stripe/${name}`, import.meta.url), 'utf8'));

const realInvoice = load('invoice.paid.dahlia.json').object; // billing_reason 'subscription_cycle'
const EVENT = { id: 'evt_test_123', type: 'invoice.paid' };

// A recording emitter, and a throwing one for the fail-soft property.
const recorder = () => {
  const calls = [];
  const emit = async (input) => { calls.push(input); };
  return { emit, calls };
};
const throwingEmit = async () => { throw new Error('admin_alerts write failed'); };

// ── isSubscriptionInvoice: the ours / not-ours classifier ─────────────────────
test('isSubscriptionInvoice: true for a real subscription-cycle invoice (drives the 500 path)', () => {
  assert.equal(isSubscriptionInvoice(realInvoice), true);
});

test('isSubscriptionInvoice: true when parent.type is subscription_details even without billing_reason', () => {
  assert.equal(isSubscriptionInvoice({ parent: { type: 'subscription_details' } }), true);
});

test('isSubscriptionInvoice: false for a one-off invoice (drives the 200/break path)', () => {
  assert.equal(isSubscriptionInvoice({ billing_reason: 'manual', parent: null }), false);
  assert.equal(isSubscriptionInvoice({}), false);
  assert.equal(isSubscriptionInvoice(null), false);
});

// ── Case: unresolvable field on an ours event -> 500 + correct alert ──────────
test('fieldMissingResponse: returns 500 and emits billing.webhook_field_missing with the exact payload', async () => {
  const { emit, calls } = recorder();
  const res = await fieldMissingResponse(emit, EVENT, 'invoice.subscription', {
    customerId: 'cus_x', billingReason: 'subscription_cycle',
  });
  assert.equal(res.status, 500);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'billing.webhook_field_missing');
  assert.equal(calls[0].severity, 'critical');
  assert.deepEqual(calls[0].payload, {
    event_id: 'evt_test_123', event_type: 'invoice.paid', field: 'invoice.subscription',
    subscription_id: null, customer_id: 'cus_x', billing_reason: 'subscription_cycle',
  });
});

// ── Case: a write failure -> 500 + correct alert ──────────────────────────────
test('writeFailedResponse: returns 500 and emits billing.webhook_write_failed with the error message', async () => {
  const { emit, calls } = recorder();
  const res = await writeFailedResponse(emit, EVENT, new Error('P2024 pool timeout'), {
    subscriptionId: 'sub_x', customerId: 'cus_x',
  });
  assert.equal(res.status, 500);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'billing.webhook_write_failed');
  assert.equal(calls[0].severity, 'critical');
  assert.equal(calls[0].payload.error, 'P2024 pool timeout');
  assert.equal(calls[0].payload.subscription_id, 'sub_x');
});

// ── Case: the 500 STILL returns when the emitter itself throws ─────────────────
// This is the load-bearing property: Stripe's retry must never depend on the observability write.
test('fieldMissingResponse: still returns 500 when the emitter throws', async () => {
  const res = await fieldMissingResponse(throwingEmit, EVENT, 'current_period_end', { subscriptionId: 'sub_x' });
  assert.equal(res.status, 500);
});

test('writeFailedResponse: still returns 500 when the emitter throws', async () => {
  const res = await writeFailedResponse(throwingEmit, EVENT, new Error('db down'), { subscriptionId: 'sub_x' });
  assert.equal(res.status, 500);
});
