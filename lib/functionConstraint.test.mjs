// Regression battery for the approved-function CONSTRAINT (see functionPatterns.ts). Run: `npm test`.
//
// The invariant: a function assigned to a behavior must be a member of that behavior's EFFECTIVE set —
// the assessment-approved set narrowed to what the client's ABA Matrix dropdown can record
// (approved ∩ observedCatalog.aba_matrix.current.functions). When no catalog was captured, effective =
// approved (the common path — most clients have no catalog yet). Nothing here is client-specific: every
// case feeds (approvedFunctions, matrixFunctions) as data and asserts the SAME function resolves them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  constrainFunctionToApproved, effectiveAllowedFunctions, functionToCanonical, normalizeApprovedFunctions,
  deriveBehaviorFunction, segmentNoteByBehavior, inferFunctionFromAntecedent,
} from './functionPatterns.ts';

test('label <-> canonical mapping', () => {
  assert.equal(functionToCanonical('Automatic Reinforcement'), 'automatic');
  assert.equal(functionToCanonical('Escape'), 'escape');
  assert.equal(functionToCanonical('Tangibles'), 'tangible');
  assert.equal(functionToCanonical('attention'), 'attention');
  assert.equal(functionToCanonical('unknown'), null);
  assert.deepEqual([...normalizeApprovedFunctions(['escape', 'Tangible'])].sort(), ['escape', 'tangible']);
});

test('effectiveAllowedFunctions narrows only when a catalog exists', () => {
  // No catalog -> effective = approved (never narrow).
  const a = effectiveAllowedFunctions(['automatic', 'escape'], null);
  assert.deepEqual([...a.allowed].sort(), ['automatic', 'escape']);
  assert.equal(a.matrixKnown, false);
  // Catalog present -> intersection.
  const b = effectiveAllowedFunctions(['automatic', 'escape'], ['Attention', 'Escape', 'Tangibles']);
  assert.deepEqual([...b.allowed], ['escape']);
  assert.equal(b.matrixKnown, true);
});

test('no approved set captured -> not constrained (never block on missing data)', () => {
  const r = constrainFunctionToApproved('Automatic Reinforcement', [], 'anything');
  assert.equal(r.status, 'unconstrained');
  assert.equal(r.fn, 'Automatic Reinforcement');
});

test('an approved, recordable function is kept as-is', () => {
  const r = constrainFunctionToApproved('Escape', ['escape', 'tangible', 'attention'], 'demand presented');
  assert.equal(r.fn, 'Escape');
  assert.equal(r.status, 'approved');
});

// ─── Per-client generality: same function, each client's OWN (approved, matrix) data ─────────────────

// FELIX (catalog present: [Attention, Escape, Tangibles], no Automatic).
// Throwing Objects approved=[automatic,escape] -> intersection {escape}: the written Automatic is not
// recordable, but Escape is — resolve to Escape (via antecedent OR the sole-member default), never blank.
test('Felix / Throwing Objects: approved∩matrix={escape} resolves to Escape (antecedent-supported)', () => {
  const r = constrainFunctionToApproved(
    'Automatic Reinforcement', ['automatic', 'escape'], 'presented with a fine motor task',
    ['Attention', 'Escape', 'Tangibles']);
  assert.equal(r.fn, 'Escape');
  assert.equal(r.status, 'corrected');
});
test('Felix / Throwing Objects: single-member intersection fills even with a neutral antecedent', () => {
  const r = constrainFunctionToApproved(
    'Automatic Reinforcement', ['automatic', 'escape'], 'the behavior occurred',
    ['Attention', 'Escape', 'Tangibles']);
  assert.equal(r.fn, 'Escape', 'sole recordable approved function is forced, never blank');
  assert.equal(r.status, 'defaulted');
});
// FELIX / Fidgeting approved=[automatic] -> intersection EMPTY: config gap, blank + FUNCTION_NOT_IN_MATRIX.
test('Felix / Fidgeting: approved=[automatic] with no Automatic in matrix -> config gap, not a silent blank', () => {
  const r = constrainFunctionToApproved(
    'Automatic Reinforcement', ['automatic'], 'during independent play', ['Attention', 'Escape', 'Tangibles']);
  assert.equal(r.fn, null);
  assert.equal(r.status, 'not_in_matrix');
  assert.deepEqual(r.unrecordable, ['Automatic Reinforcement']);
});

// ALEXANDRA (no catalog captured -> assessment-only fallback). Defiant Behavior approved=[escape,attention].
test('Alexandra / catalog absent: written approved function is kept (assessment-only)', () => {
  const r = constrainFunctionToApproved('Attention', ['escape', 'attention'], 'adult attention was directed away');
  assert.equal(r.fn, 'Attention');
  assert.equal(r.status, 'approved');
});

// BRANDON (no catalog captured). Off-Task Behavior approved=[escape,tangible]; note gives no function,
// antecedent is a demand -> infer + keep Escape. No catalog means no narrowing, no regression.
test('Brandon / catalog absent: unknown function inferred from antecedent within approved set', () => {
  const r = constrainFunctionToApproved('unknown', ['escape', 'tangible'], 'the client was asked to complete a task');
  assert.equal(r.fn, 'Escape');
  assert.equal(r.status, 'corrected');
});

// BRAND-NEW CLIENT we've never seen: purely from supplied profile + catalog, no literals in the fix.
// approved=[tangible,attention], matrix has both -> written Tangible kept.
test('brand-new client: resolves from supplied profile + catalog alone', () => {
  const r = constrainFunctionToApproved('Tangible', ['tangible', 'attention'], 'preferred item was withheld',
    ['Attention', 'Tangibles']);
  assert.equal(r.fn, 'Tangibles');
  assert.equal(r.status, 'approved');
});
// ...and its config-gap twin: assessment approves a function the new client's matrix lacks entirely.
test('brand-new client: assessment function absent from matrix -> config gap', () => {
  const r = constrainFunctionToApproved('Automatic Reinforcement', ['automatic'], 'no clear antecedent',
    ['Attention', 'Escape']);
  assert.equal(r.status, 'not_in_matrix');
  assert.deepEqual(r.unrecordable, ['Automatic Reinforcement']);
});

// ─── The "fine motor task" antecedent coverage gap (a fine-motor task IS a demand = escape) ───────────
test('antecedent fallback: a fine-motor task is a demand -> Escape', () => {
  for (const ant of [
    'presented with a fine motor task',
    'during a fine motor task',
    'a fine motor task without apparent cause',
    'engaged in a gross motor task',
    'introduced to a sorting task',
  ]) {
    assert.equal(inferFunctionFromAntecedent(ant), 'Escape', `"${ant}" should infer Escape`);
  }
});
test('antecedent fallback: "off-task"/"on-task" prose does NOT spuriously infer Escape via the task pattern', () => {
  // These describe engagement, not a presented demand — the new pattern must not catch them.
  assert.equal(inferFunctionFromAntecedent('the client remained off-task and gazed around the room'), null);
  assert.equal(inferFunctionFromAntecedent('the client stayed on-task throughout'), null);
});

// End-to-end on prose: Throwing Objects written with an Automatic conclusion never survives as Automatic
// for an escape-recordable client.
test('derive + constrain: Throwing Objects never resolves to Automatic when the matrix lacks it', () => {
  const note =
    'During the transition from a preferred activity to a table task, the client engaged in throwing objects, ' +
    'consistent with automatic reinforcement.';
  const behavior = { name: 'Throwing Objects', topography: 'throwing objects', antecedent: 'transition from a preferred activity to a table task' };
  const [segment] = segmentNoteByBehavior(note, [behavior]);
  const wrote = deriveBehaviorFunction(segment, behavior).resolved;
  const r = constrainFunctionToApproved(wrote, ['automatic', 'escape'], behavior.antecedent, ['Attention', 'Escape', 'Tangibles']);
  assert.notEqual(r.fn, 'Automatic Reinforcement');
  assert.equal(r.fn, 'Escape');
});
