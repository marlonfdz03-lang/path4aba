// Locks the reinforcement-schedule fill logic (see scheduleFill.ts). Run: `npm test`.
// The rule: transcribe the note's STATED schedule; default to "Continuous" ONLY when none is stated. A stated
// value is NEVER overridden by the default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleFillValue } from './scheduleFill.ts';

test('stated schedule → transcribed (default skipped)', () => {
  assert.equal(scheduleFillValue('Fixed Ratio (FR) Schedule'), 'Fixed Ratio (FR) Schedule');
  assert.equal(scheduleFillValue('Variable Ratio (VR) Schedule'), 'Variable Ratio (VR) Schedule');
  assert.equal(scheduleFillValue('FR3'), 'FR3'); // a specific stated value is preserved verbatim, not defaulted
});

test('note does not specify → "Continuous" (fallback only)', () => {
  assert.equal(scheduleFillValue(''), 'Continuous');
  assert.equal(scheduleFillValue('   '), 'Continuous'); // whitespace-only counts as unstated
  assert.equal(scheduleFillValue(undefined), 'Continuous');
  assert.equal(scheduleFillValue(null), 'Continuous');
});

test('a stated value is NEVER overridden by the default', () => {
  for (const stated of ['Continuous Reinforcement', 'Fixed Ratio (FR) Schedule', 'other', 'VR5']) {
    assert.equal(scheduleFillValue(stated), stated);
  }
});
