// subscription_events writer: the replacement predicate + the fail-soft contract. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAlertIdReplaced, recordSubscriptionEvent } from './subscriptionEvents.ts';

// ── billing.subscription_id_replaced predicate ───────────────────────────────
test('first write (old null) → NO alert', () => {
  assert.equal(shouldAlertIdReplaced(null, 'sub_new'), false);
  assert.equal(shouldAlertIdReplaced(undefined, 'sub_new'), false);
});

test('same id → NO alert', () => {
  assert.equal(shouldAlertIdReplaced('sub_x', 'sub_x'), false);
});

test('different non-null id → ALERT (the orphan signal)', () => {
  assert.equal(shouldAlertIdReplaced('sub_old', 'sub_new'), true);
});

test('new id null → NO alert (nothing is replacing it)', () => {
  assert.equal(shouldAlertIdReplaced('sub_old', null), false);
  assert.equal(shouldAlertIdReplaced('sub_old', undefined), false);
  assert.equal(shouldAlertIdReplaced('sub_old', ''), false);
});

test('both null → NO alert', () => {
  assert.equal(shouldAlertIdReplaced(null, null), false);
});

// ── fail-soft contract ───────────────────────────────────────────────────────
test('recordSubscriptionEvent NEVER throws — a write failure resolves silently', async () => {
  // In bare node the lazy `@/lib/prisma` import cannot resolve, so the create fails; the helper must swallow
  // it and resolve (a throw here would 500 the webhook and make Stripe retry the event). This exercises the
  // exact fail-soft path.
  await assert.doesNotReject(
    recordSubscriptionEvent({ eventType: 'checkout.completed', source: 'webhook', userId: 'u1', newStatus: 'trialing' })
  );
});
