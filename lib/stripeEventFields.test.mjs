// Tests for the Stripe event-field readers. Run with: npm test (node --test).
// These assert against REAL dahlia payloads captured from the Stripe dashboard
// (lib/__fixtures__/stripe/*.dahlia.json) so we test Stripe's actual shape, not a
// description of it — plus hand-built pre-Basil fixtures to prove the fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subCurrentPeriodEnd, invoiceSubscriptionId, epochToDate } from './stripeEventFields.ts';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/stripe/${name}`, import.meta.url), 'utf8'));

const subDahlia = load('subscription.updated.dahlia.json');
const subPreBasil = load('subscription.updated.prebasil.json');
const invDahlia = load('invoice.paid.dahlia.json');
const invPreBasil = load('invoice.paid.prebasil.json');

// ── The bug precondition, asserted against the real bytes ──────────────────────
// If these ever start failing because the top-level field is present again, the
// fallback still covers us — but this documents WHY the readers exist.
test('real dahlia subscription: current_period_end is ABSENT at top level', () => {
  assert.equal(subDahlia.object.current_period_end, undefined);
  assert.equal(typeof subDahlia.object.items.data[0].current_period_end, 'number');
});

test('real dahlia invoice: subscription is ABSENT at top level', () => {
  assert.equal(invDahlia.object.subscription, undefined);
  assert.equal(typeof invDahlia.object.parent.subscription_details.subscription, 'string');
});

// ── subCurrentPeriodEnd ───────────────────────────────────────────────────────
test('subCurrentPeriodEnd: reads the per-item field from a real dahlia payload', () => {
  assert.equal(subCurrentPeriodEnd(subDahlia.object), 1790273860);
});

test('subCurrentPeriodEnd: falls back to the top-level field (pre-Basil)', () => {
  assert.equal(subCurrentPeriodEnd(subPreBasil.object), 1790273860);
});

test('subCurrentPeriodEnd: null when neither path resolves (resolution failure)', () => {
  assert.equal(subCurrentPeriodEnd({ items: { data: [{}] } }), null);
  assert.equal(subCurrentPeriodEnd({}), null);
  assert.equal(subCurrentPeriodEnd(null), null);
  assert.equal(subCurrentPeriodEnd(undefined), null);
});

// ── invoiceSubscriptionId ─────────────────────────────────────────────────────
test('invoiceSubscriptionId: reads parent.subscription_details from a real dahlia payload', () => {
  assert.equal(invoiceSubscriptionId(invDahlia.object), 'sub_1Tj9J63rm4ZConVQamTBmvKP');
});

test('invoiceSubscriptionId: falls back to top-level invoice.subscription (pre-Basil)', () => {
  assert.equal(invoiceSubscriptionId(invPreBasil.object), 'sub_prebasil0000000000');
});

test('invoiceSubscriptionId: handles an expanded subscription object (id extracted)', () => {
  assert.equal(
    invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_expanded' } } } }),
    'sub_expanded',
  );
});

test('invoiceSubscriptionId: null when neither path resolves (resolution failure)', () => {
  assert.equal(invoiceSubscriptionId({ parent: { subscription_details: {} } }), null);
  assert.equal(invoiceSubscriptionId({}), null);
  assert.equal(invoiceSubscriptionId(null), null);
  assert.equal(invoiceSubscriptionId(undefined), null);
});

// ── epochToDate: the ONLY sanctioned epoch->Date path; never yields Invalid Date ─
test('epochToDate: converts a finite epoch to the correct Date', () => {
  const d = epochToDate(1790217262);
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), 1790217262 * 1000);
});

test('epochToDate: returns null for anything that would be an Invalid Date', () => {
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, '1790217262', {}, []]) {
    assert.equal(epochToDate(bad), null, `expected null for ${String(bad)}`);
  }
});

test('epochToDate: the missing-field composition never builds new Date(NaN)', () => {
  // This is the exact production failure: field missing -> reader null -> epochToDate null.
  const d = epochToDate(subCurrentPeriodEnd({}));
  assert.equal(d, null);
});

// ── Scrub guard: the committed invoice fixture must contain no personal data ────
test('invoice fixture is scrubbed of PII', () => {
  const raw = readFileSync(
    new URL('./__fixtures__/stripe/invoice.paid.dahlia.json', import.meta.url),
    'utf8',
  );
  assert.equal(raw.includes('yunymntz78'), false, 'real email local-part leaked');
  assert.equal(raw.includes('yahoo'), false, 'real email domain leaked');
  assert.equal(raw.includes('invoice.stripe.com'), false, 'hosted_invoice_url leaked');
  assert.equal(raw.includes('pay.stripe.com'), false, 'invoice_pdf url leaked');
  assert.equal(raw.includes('MEFQNH4K'), false, 'real invoice number leaked');
  assert.equal(raw.includes('PATH4ABA'), false, 'real account name leaked');
  // The scrubbed placeholders are present, and the structural paths survived.
  assert.equal(invDahlia.object.customer_email, 'test@example.com');
  assert.equal(invDahlia.object.hosted_invoice_url, null);
  assert.equal(invDahlia.object.invoice_pdf, null);
  assert.equal(invDahlia.object.number, 'TEST-0001');
  assert.equal(invDahlia.object.account_name, 'TEST ACCOUNT');
  assert.equal(invDahlia.object.lines.data[0].period.end, 1790217262);
});
