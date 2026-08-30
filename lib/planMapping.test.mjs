// Billing branch/resolver pure logic (lib/planMapping.ts). Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDirection, buildPriceToPlan, planFromPriceId, mapStripeStatus,
  classifySubscriptions, resolveStateFromLister,
} from './planMapping.ts';

// ── planDirection ────────────────────────────────────────────────────────────
test('planDirection by tier (upgrade / downgrade)', () => {
  assert.equal(planDirection(1, 2), 'upgrade');   // rbt_1 -> rbt_2
  assert.equal(planDirection(2, 1), 'downgrade');  // rbt_2 -> rbt_1
});
test('planDirection equal-tier falls back to amount (interval switch)', () => {
  assert.equal(planDirection(1, 1, 1000, 10000), 'upgrade');   // monthly -> yearly (costs more now)
  assert.equal(planDirection(1, 1, 10000, 1000), 'downgrade');  // yearly -> monthly
});
test('planDirection equal-tier AND equal-amount (or equal price) -> unchanged', () => {
  assert.equal(planDirection(1, 1, 1000, 1000), 'unchanged');
  assert.equal(planDirection(2, 2), 'unchanged');
});

// ── price -> plan reverse lookup ─────────────────────────────────────────────
const PRICES = { rbt_1: { month: 'price_r1m', year: 'price_r1y' }, rbt_2: { month: 'price_r2m', year: 'price_r2y' } };
const STUDENTS = { addon: { month: 'price_am', year: 'price_ay' }, standalone: { month: 'price_sm', year: 'price_sy' } };
const MAP = buildPriceToPlan(PRICES, STUDENTS);
test('planFromPriceId maps every price id to its plan; students collapse to bcba_students; unknown -> null', () => {
  assert.equal(planFromPriceId('price_r1m', MAP), 'rbt_1');
  assert.equal(planFromPriceId('price_r2y', MAP), 'rbt_2');
  assert.equal(planFromPriceId('price_am', MAP), 'bcba_students');
  assert.equal(planFromPriceId('price_sy', MAP), 'bcba_students');
  assert.equal(planFromPriceId('price_unknown', MAP), null);
  assert.equal(planFromPriceId(null, MAP), null);
});

// ── mapStripeStatus ──────────────────────────────────────────────────────────
test('mapStripeStatus', () => {
  assert.equal(mapStripeStatus('active'), 'active');
  assert.equal(mapStripeStatus('trialing'), 'trialing');
  assert.equal(mapStripeStatus('canceled'), 'canceled');
  assert.equal(mapStripeStatus('incomplete_expired'), 'canceled');
  assert.equal(mapStripeStatus('past_due'), 'expired');
  assert.equal(mapStripeStatus('unpaid'), 'expired');
});

// ── classifySubscriptions ────────────────────────────────────────────────────
const RELEVANT = new Set(['price_r1m', 'price_r1y', 'price_r2m', 'price_r2y']);
const sub = (status, priceId, itemId = 'si_1') => ({ status, items: { data: [{ id: itemId, price: { id: priceId } }] } });
test('classify: live when a relevant sub is active/trialing/past_due', () => {
  const r = classifySubscriptions([sub('active', 'price_r2m', 'si_x')], false, RELEVANT);
  assert.equal(r.state, 'live');
  assert.equal(r.itemId, 'si_x');
});
test('classify: lapsed when a relevant sub exists but none live', () => {
  assert.equal(classifySubscriptions([sub('canceled', 'price_r1m')], false, RELEVANT).state, 'lapsed');
});
test('classify: none when no relevant sub', () => {
  assert.equal(classifySubscriptions([sub('active', 'price_other')], false, RELEVANT).state, 'none');
  assert.equal(classifySubscriptions([], false, RELEVANT).state, 'none');
});
test('classify: has_more with no match -> lapsed (never grant a trial we cannot rule out)', () => {
  assert.equal(classifySubscriptions([], true, RELEVANT).state, 'lapsed');
});

// ── resolveStateFromLister: FAIL CLOSED ──────────────────────────────────────
test('resolver FAIL CLOSED on throw -> unavailable (never none)', async () => {
  const r = await resolveStateFromLister(async () => { throw new Error('stripe down'); }, RELEVANT, 1000);
  assert.equal(r.state, 'unavailable');
});
test('resolver FAIL CLOSED on timeout -> unavailable', async () => {
  const hang = () => new Promise(() => {}); // never resolves
  const r = await resolveStateFromLister(hang, RELEVANT, 50); // 50ms timeout
  assert.equal(r.state, 'unavailable');
});
test('resolver happy path classifies a returned page', async () => {
  const r = await resolveStateFromLister(async () => ({ data: [sub('trialing', 'price_r1m', 'si_ok')], has_more: false }), RELEVANT, 1000);
  assert.equal(r.state, 'live');
  assert.equal(r.itemId, 'si_ok');
});
