// Strict intervention canonicalizer. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalIntervention } from './interventionCanonical.ts';

test('MARLON REQUIRED: DRA / DRI / DRO stay DISTINCT (never unified by fuzzy word matching)', () => {
  const dra = canonicalIntervention('Differential Reinforcement of Alternative Behavior (DRA)');
  const dri = canonicalIntervention('Differential Reinforcement of Incompatible Behaviors (DRI)');
  const dro = canonicalIntervention('Differential Reinforcement of Other Behavior (DRO)');
  assert.equal(dra, 'DRA');
  assert.equal(dri, 'DRI');
  assert.equal(dro, 'DRO');
  assert.equal(new Set([dra, dri, dro]).size, 3, 'three distinct ids');
  // plural / casing variants seen in real profiles resolve to the same ids
  assert.equal(canonicalIntervention('Differential reinforcement of alternative behaviors (DRA)'), 'DRA');
  assert.equal(canonicalIntervention('Differential Reinforcement of Incompatible Behavior (DRI)'), 'DRI');
  assert.equal(canonicalIntervention('Differential Reinforcement of Other Behaviors (DRO)'), 'DRO');
});

test('acronym in parens and standalone both resolve', () => {
  assert.equal(canonicalIntervention('Functional Communication Training (FCT)'), 'FCT');
  assert.equal(canonicalIntervention('Functional Communication Training'), 'FCT');
  assert.equal(canonicalIntervention('FCT training'), 'FCT');
  assert.equal(canonicalIntervention('Noncontingent Reinforcement (NCR)'), 'NCR');
  assert.equal(canonicalIntervention('Non-contingent Reinforcement'), 'NCR');
});

test('explicit phrase table (deliberate equivalences only)', () => {
  assert.equal(canonicalIntervention('Premack Principle'), 'Premack');
  assert.equal(canonicalIntervention('Premack'), 'Premack');
  assert.equal(canonicalIntervention('Behavioral Momentum'), 'Behavior Momentum');
  assert.equal(canonicalIntervention('Behavior Momentum'), 'Behavior Momentum');
  assert.equal(canonicalIntervention('Planned Ignore'), 'Planned Ignoring');
  assert.equal(canonicalIntervention('Planned Ignoring'), 'Planned Ignoring');
});

test('MARLON REQUIRED: NO automatic semantic aliasing — Manipulations ≠ Modification', () => {
  const em = canonicalIntervention('Environmental Manipulations/Antecedent Manipulations');
  assert.notEqual(em, 'Environmental Modification', 'must NOT be force-fitted to the map term');
  assert.equal(em, 'Environmental Manipulations/Antecedent Manipulations', 'passes through unchanged');
  // the map term itself canonicalizes to itself, so the two never intersect
  assert.equal(canonicalIntervention('Environmental Modification'), 'Environmental Modification');
});

test('unknown / non-map interventions pass through trimmed (never force-fitted)', () => {
  assert.equal(canonicalIntervention('Redirection'), 'Redirection');
  assert.equal(canonicalIntervention('  Provide Choices  '), 'Provide Choices');
  assert.equal(canonicalIntervention('Response Block (15 seconds)'), 'Response Block (15 seconds)'); // (15 seconds) is not an acronym
  assert.equal(canonicalIntervention(''), '');
});
