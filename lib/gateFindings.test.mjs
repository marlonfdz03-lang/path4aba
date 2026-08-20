// Regression for the gate-findings recorder (see gateFindings.ts). Run: `npm test`.
//
// The invariant: a clinical gate NEVER blocks a note. Every finding is recorded for the admin panel
// and the note ships. These cover the pure collection step; recordGateFindings is fail-soft by
// contract and is not exercised here (it needs a database).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGateFindings } from './gateFindings.ts';

const state = (over = {}) => ({
  intervention: { prohibited: [], unapproved: [], skillAsReduction: [] },
  functionViolations: [],
  coverage: { segmentable: true, missing: [] },
  methodViolations: [],
  approvedInterventions: ['DRA'],
  approvedMethodSet: [],
  ...over,
});

test('a clean note produces no findings', () => {
  assert.deepEqual(collectGateFindings({ state: state() }), []);
});

test('a prohibited intervention is CRITICAL — it must never be missed', () => {
  const f = collectGateFindings({ state: state({ intervention: { prohibited: ['RIRD'], unapproved: [], skillAsReduction: [] } }) });
  assert.equal(f.length, 1);
  assert.equal(f[0].gate, 'intervention');
  assert.equal(f[0].severity, 'critical');
  assert.match(f[0].detail, /RIRD/);
});

test('an unapproved intervention is a warning, not a block', () => {
  const f = collectGateFindings({ state: state({ intervention: { prohibited: [], unapproved: ['Behavior Momentum'], skillAsReduction: [] } }) });
  assert.equal(f[0].severity, 'warning');
  assert.equal(f[0].context.kind, 'unapproved');
});

test('every gate reports: function, coverage, teaching method', () => {
  const f = collectGateFindings({
    state: state({
      functionViolations: [{ name: 'Tantrum', wrote: 'Automatic', approved: ['escape'] }],
      coverage: { segmentable: true, missing: [{ name: 'Throwing' }] },
      methodViolations: ['Modeling'],
    }),
  });
  assert.deepEqual(f.map((x) => x.gate).sort(), ['approved-function', 'coverage', 'teaching-method']);
});

test('an unsegmentable note is info, not a failure', () => {
  const f = collectGateFindings({ state: state({ coverage: { segmentable: false, missing: [] } }) });
  assert.equal(f[0].gate, 'coverage');
  assert.equal(f[0].severity, 'info');
});

test('a behavior with no documented function is a DATA finding, never guessed around', () => {
  const f = collectGateFindings({ state: state(), behaviorsWithoutFunction: ['Elopement'] });
  assert.equal(f[0].gate, 'data-integrity');
  assert.match(f[0].detail, /no documented function in the assessment/);
});

test('advisory flags are recorded as info', () => {
  const f = collectGateFindings({
    coherenceFlags: ['function may not match antecedent'],
    redFlags: ['vague phrase'],
    blockedFlagged: ['sensory'],
    similarityWarning: true,
  });
  assert.deepEqual(f.map((x) => x.gate), ['coherence', 'red-flag', 'blocked-term', 'similarity']);
  assert.ok(f.every((x) => x.severity === 'info'));
});

test('findings can be collected with no gate state at all (refine path)', () => {
  assert.deepEqual(collectGateFindings({}), []);
  assert.equal(collectGateFindings({ redFlags: ['x'] }).length, 1);
});
