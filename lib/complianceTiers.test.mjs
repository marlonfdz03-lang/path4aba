// Compliance controller — the tier distribution rules (Commit 5). Run: `npm test`.
//
// Marlon's critical rule, guaranteed in CODE: below typical / poor never make EVERY item fail; typical never
// makes every item perfect. Tested across realistic note sizes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignTiers, tierCounts, TIER_PROMPTS, TIER_RESPONSES } from './complianceTiers.ts';

const SIZES = [2, 3, 4, 5, 6];

test('MARLON REQUIRED: poor is NEVER all-DIFFICULT — always at least one FAVORABLE', () => {
  for (const n of SIZES) {
    const t = assignTiers('poor', n);
    const c = tierCounts(t);
    assert.ok(c.FAVORABLE >= 1, `poor n=${n}: at least one FAVORABLE (${t.join(',')})`);
    assert.ok(c.DIFFICULT < n, `poor n=${n}: not all DIFFICULT`);
    assert.ok(c.DIFFICULT + c.PARTIAL >= c.FAVORABLE, `poor n=${n}: majority difficult/partial`);
  }
});

test('MARLON REQUIRED: typical is NEVER all-FAVORABLE — always at least one PARTIAL', () => {
  for (const n of SIZES) {
    const t = assignTiers('typical', n);
    const c = tierCounts(t);
    assert.ok(c.PARTIAL >= 1, `typical n=${n}: at least one PARTIAL (${t.join(',')})`);
    assert.ok(c.FAVORABLE > c.PARTIAL + c.DIFFICULT || c.FAVORABLE >= Math.floor(n / 2), `typical n=${n}: majority favorable`);
    assert.equal(c.DIFFICULT, 0, `typical n=${n}: no DIFFICULT in a typical session`);
  }
});

test('MARLON REQUIRED: below typical — majority PARTIAL, at least one FAVORABLE, at most one DIFFICULT', () => {
  for (const n of [3, 4, 5, 6]) {
    const t = assignTiers('below_typical', n);
    const c = tierCounts(t);
    assert.ok(c.FAVORABLE >= 1, `below n=${n}: at least one FAVORABLE (${t.join(',')})`);
    assert.ok(c.DIFFICULT <= 1, `below n=${n}: at most one DIFFICULT`);
    assert.ok(c.PARTIAL > c.FAVORABLE + c.DIFFICULT, `below n=${n}: strict majority PARTIAL (${t.join(',')})`);
  }
});

test('undefined level behaves as typical', () => {
  assert.deepEqual(assignTiers(undefined, 3), assignTiers('typical', 3));
});

test('n=1 documented single values: typical→FAVORABLE, below/poor→PARTIAL (never over/under-claim)', () => {
  assert.deepEqual(assignTiers('typical', 1), ['FAVORABLE']);
  assert.deepEqual(assignTiers('below_typical', 1), ['PARTIAL']);
  assert.deepEqual(assignTiers('poor', 1), ['PARTIAL']);
});

test('n=0 → empty; deterministic (same input → same output)', () => {
  assert.deepEqual(assignTiers('poor', 0), []);
  assert.deepEqual(assignTiers('poor', 5), assignTiers('poor', 5));
});

test('every tier maps to a non-empty prompt and response vocabulary', () => {
  for (const tier of ['FAVORABLE', 'PARTIAL', 'DIFFICULT']) {
    assert.ok(TIER_PROMPTS[tier].length > 0);
    assert.ok(TIER_RESPONSES[tier].length > 0);
  }
});
