// Regression battery for the approved-function CONSTRAINT (see functionPatterns.ts). Run: `npm test`.
//
// The invariant: a function assigned to a behavior must be a member of that behavior's assessment-
// approved set. Seed case is Felix's "Throwing Objects" — approved [escape] (also tangible/attention
// in the real profile) but NEVER automatic — which must never be assigned Automatic Reinforcement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  constrainFunctionToApproved, functionToCanonical, normalizeApprovedFunctions,
  deriveBehaviorFunction, segmentNoteByBehavior,
} from './functionPatterns.ts';

test('label <-> canonical mapping', () => {
  assert.equal(functionToCanonical('Automatic Reinforcement'), 'automatic');
  assert.equal(functionToCanonical('Escape'), 'escape');
  assert.equal(functionToCanonical('Tangibles'), 'tangible');
  assert.equal(functionToCanonical('attention'), 'attention');
  assert.equal(functionToCanonical('unknown'), null);
  assert.deepEqual([...normalizeApprovedFunctions(['escape', 'Tangible'])].sort(), ['escape', 'tangible']);
});

// SEED CASE: Throwing Objects approved only for [escape] must never be assigned Automatic.
test('an unapproved Automatic is rejected when the antecedent supports no approved function', () => {
  const r = constrainFunctionToApproved('Automatic Reinforcement', ['escape'], 'the behavior occurred');
  assert.equal(r.fn, null, 'no approved function fits -> blank for review, never Automatic');
  assert.equal(r.status, 'unapproved');
});

test('an unapproved Automatic is CORRECTED to an approved function the antecedent supports', () => {
  // Escape is approved; the antecedent is a demand/transition -> infer Escape, use it instead of Automatic.
  const r = constrainFunctionToApproved('Automatic Reinforcement', ['escape'], 'the RBT presented a demand to clean up');
  assert.equal(r.fn, 'Escape');
  assert.equal(r.status, 'corrected');
  assert.equal(r.from, 'Automatic Reinforcement');
});

test('an approved function is kept as-is', () => {
  const r = constrainFunctionToApproved('Escape', ['escape', 'tangible', 'attention'], 'demand presented');
  assert.equal(r.fn, 'Escape');
  assert.equal(r.status, 'approved');
});

test('no approved set captured -> not constrained (never block on missing data)', () => {
  const r = constrainFunctionToApproved('Automatic Reinforcement', [], 'anything');
  assert.equal(r.status, 'unconstrained');
  assert.equal(r.fn, 'Automatic Reinforcement');
});

// End-to-end on prose: Throwing Objects written with an ESCAPE antecedent + Automatic conclusion.
test('derive + constrain: Throwing Objects [escape] never resolves to Automatic', () => {
  const note =
    'During the transition from a preferred activity to a table task, Felix engaged in throwing objects, ' +
    'consistent with automatic reinforcement.';
  const behavior = { name: 'Throwing Objects', topography: 'throwing objects', antecedent: 'transition from a preferred activity to a table task' };
  const [segment] = segmentNoteByBehavior(note, [behavior]);
  const wrote = deriveBehaviorFunction(segment, behavior).resolved; // 'Automatic Reinforcement' or 'unknown'
  const r = constrainFunctionToApproved(wrote, ['escape'], behavior.antecedent);
  assert.notEqual(r.fn, 'Automatic Reinforcement', 'must never end up Automatic for an escape-only behavior');
  if (wrote !== 'unknown') assert.equal(r.fn, 'Escape');
});
