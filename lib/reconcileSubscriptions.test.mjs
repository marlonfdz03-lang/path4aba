// Tests for the reconcile pure core. Run with: npm test (node --test).
// Uses the real dahlia subscription fixture (sub_1TjO1y…, active, item period 1790273860 = 2026-09-23,
// price = rbt_1) as the Stripe side, and synthetic DB rows as the drift target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcilePrimary, reconcileBcba, shouldAbort, ABORT_MIN_ROWS } from './reconcileSubscriptions.ts';

const sub = JSON.parse(
  readFileSync(new URL('./__fixtures__/stripe/subscription.updated.dahlia.json', import.meta.url), 'utf8'),
).object;

// price_1TfQ6m3rm4ZConVQ4qrNACgw = STRIPE_PRICE_RBT_1_MONTHLY
const PRICE_TO_PLAN = new Map([['price_1TfQ6m3rm4ZConVQ4qrNACgw', 'rbt_1']]);
const STRIPE_PERIOD = new Date(1790273860 * 1000); // 2026-09-24 UTC

// ── reconcilePrimary: the fdfa0696/Mailay-shaped period drift ────────────────
test('reconcilePrimary: corrects a stale period, leaves matching columns alone', () => {
  const row = { plan: 'rbt_1', status: 'active', current_period_ends_at: new Date('2026-07-24T00:00:00Z'), trial_ends_at: null };
  const { data, drifts } = reconcilePrimary(row, sub, PRICE_TO_PLAN);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].column, 'current_period_ends_at');
  assert.equal(drifts[0].oldValue, '2026-07-24');
  assert.equal(drifts[0].newValue, '2026-09-24');
  assert.equal(data.current_period_ends_at.getTime(), STRIPE_PERIOD.getTime());
  assert.equal('status' in data, false); // active === active, untouched
  assert.equal('plan' in data, false);   // rbt_1 === rbt_1, untouched
});

test('reconcilePrimary: no drift when the row already matches Stripe', () => {
  const row = { plan: 'rbt_1', status: 'active', current_period_ends_at: STRIPE_PERIOD, trial_ends_at: null };
  const { data, drifts } = reconcilePrimary(row, sub, PRICE_TO_PLAN);
  assert.equal(drifts.length, 0);
  assert.deepEqual(data, {});
});

// ── The Mailay case: Stripe past_due -> RETRY-STATE POLICY writes 'canceled' (grace via the real period end),
//    NOT 'expired'. The reconcile must never be what removes access during a retry window. ──
test('reconcilePrimary: past_due maps to canceled (grace), never expired', () => {
  const row = { plan: 'rbt_1', status: 'active', current_period_ends_at: new Date('2026-07-24T00:00:00Z'), trial_ends_at: null };
  const { data, drifts } = reconcilePrimary(row, { ...sub, status: 'past_due' }, PRICE_TO_PLAN);
  assert.equal(data.status, 'canceled');
  // paired with the corrected (future) real period end -> the gate's canceled-grace branch keeps access
  assert.equal(data.current_period_ends_at.getTime(), STRIPE_PERIOD.getTime());
  const statusDrift = drifts.find(d => d.column === 'status');
  assert.deepEqual({ old: statusDrift.oldValue, new: statusDrift.newValue }, { old: 'active', new: 'canceled' });
});

test('reconcilePrimary: unpaid is also a retry state -> canceled', () => {
  const row = { plan: 'rbt_1', status: 'active', current_period_ends_at: STRIPE_PERIOD, trial_ends_at: null };
  const { data } = reconcilePrimary(row, { ...sub, status: 'unpaid' }, PRICE_TO_PLAN);
  assert.equal(data.status, 'canceled');
});

test('reconcilePrimary: a genuine Stripe cancel still maps to canceled (not a retry state)', () => {
  const row = { plan: 'rbt_1', status: 'active', current_period_ends_at: STRIPE_PERIOD, trial_ends_at: null };
  const { data } = reconcilePrimary(row, { ...sub, status: 'canceled' }, PRICE_TO_PLAN);
  assert.equal(data.status, 'canceled');
});

// bcba side deliberately does NOT apply the retry-state policy (no period -> no grace branch).
test('reconcileBcba: past_due maps to expired (no grace branch on the bcba side)', () => {
  const row = { bcba_students_status: 'active', bcba_students_trial_ends_at: null };
  const { data } = reconcileBcba(row, { status: 'past_due', items: { data: [{}] } });
  assert.equal(data.bcba_students_status, 'expired');
});

// ── plan drift is corrected only to a KNOWN primary plan ─────────────────────
test('reconcilePrimary: corrects plan when the row disagrees with the priced plan', () => {
  const row = { plan: 'rbt_2', status: 'active', current_period_ends_at: STRIPE_PERIOD, trial_ends_at: null };
  const { data } = reconcilePrimary(row, sub, PRICE_TO_PLAN);
  assert.equal(data.plan, 'rbt_1');
});

test('reconcilePrimary: leaves plan alone when the price is unknown (no map entry)', () => {
  const row = { plan: 'rbt_2', status: 'active', current_period_ends_at: STRIPE_PERIOD, trial_ends_at: null };
  const { data } = reconcilePrimary(row, sub, new Map()); // empty map -> planFromPriceId null
  assert.equal('plan' in data, false);
});

// ── trial_ends_at only while trialing ────────────────────────────────────────
test('reconcilePrimary: backfills trial_ends_at only when the sub is trialing', () => {
  const trialing = { ...sub, status: 'trialing', trial_end: 1793000000 };
  const row = { plan: 'rbt_1', status: 'trialing', current_period_ends_at: STRIPE_PERIOD, trial_ends_at: null };
  const { data } = reconcilePrimary(row, trialing, PRICE_TO_PLAN);
  assert.equal(data.trial_ends_at.getTime(), 1793000000 * 1000);
});

// ── reconcileBcba: status + trial only ───────────────────────────────────────
test('reconcileBcba: corrects bcba_students_status', () => {
  const bcbaSub = { status: 'canceled', items: { data: [{}] } };
  const row = { bcba_students_status: 'active', bcba_students_trial_ends_at: null };
  const { data, drifts } = reconcileBcba(row, bcbaSub);
  assert.equal(data.bcba_students_status, 'canceled');
  assert.equal(drifts[0].column, 'bcba_students_status');
});

// ── Circuit breaker ──────────────────────────────────────────────────────────
test('shouldAbort: aborts when >25% of rows 404 (the wrong-key / mode-mismatch case)', () => {
  assert.equal(shouldAbort(9, 9), true);   // all missing — the exact test-key-vs-live case
  assert.equal(shouldAbort(9, 3), true);   // 33% > 25%
});

test('shouldAbort: does NOT abort on a small sample or a low orphan rate', () => {
  assert.equal(shouldAbort(3, 3), false);          // below ABORT_MIN_ROWS
  assert.equal(shouldAbort(ABORT_MIN_ROWS, 1), false); // 25%, not > 25%
  assert.equal(shouldAbort(100, 1), false);        // one genuine orphan among many
  assert.equal(shouldAbort(9, 0), false);          // clean run
});
