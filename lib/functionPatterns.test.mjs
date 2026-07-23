// Regression guard for the FUNCTION_PATTERNS "bare clinical noun" failure class
// (see functionPatterns.ts). Run with: `npm test`  (Node's built-in runner; no deps).
//
// The rule being locked in: a pattern that determines a clinical field must match the
// ASSERTION, not the noun. Every phrase in INNOCENT is ordinary session prose that mentions
// a clinical noun WITHOUT asserting a function — none may match any pattern. Any future
// pattern change that re-introduces a bare-noun match fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTION_PATTERNS, inferFunctionFromAntecedent } from './functionPatterns.ts';

const matchedLabels = (text) => FUNCTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);

// Ordinary reinforcement / activity / antecedent prose — mentions the noun, asserts no function.
const INNOCENT = [
  'sensory break',
  'access to preferred items',
  'fidget tool',
  'adult attention nearby',
  'access to bean bags',
  'avoidance of eye contact',
  'a tangible reinforcer was delivered',
  // additions from the audit that first surfaced the bug:
  'behavior-specific praise and access to fidget tools',
  'the client shifted attention to the task',
  'attention to task materials',
  'access to a sensory bin contingent on the mand',
  'provided access to items after the response',
  'during a sensory play activity',
];

// Real function assertions — each must match exactly its function (and only that one).
const REAL = [
  ['consistent with attention-seeking behavior', 'Attention'],
  ['suggesting attention-maintained behavior', 'Attention'],
  ['the behavior was maintained by adult attention', 'Attention'],
  ['consistent with escape-motivated behavior', 'Escape'],
  ['suggesting escape-maintained behavior', 'Escape'],
  ['presentation of a demand consistent with demand avoidance', 'Escape'],
  ['consistent with tangible-motivated behavior', 'Tangibles'],
  ['suggesting tangible-maintained behavior', 'Tangibles'],
  ['maintained by access to tangibles', 'Tangibles'],
  ['consistent with automatic reinforcement', 'Automatic Reinforcement'],
  ['sensory-maintained behavior', 'Automatic Reinforcement'],
];

test('innocent clinical prose matches NO function pattern (bare-noun guard)', () => {
  for (const text of INNOCENT) {
    const hits = matchedLabels(text);
    assert.deepEqual(hits, [], `"${text}" must match no function pattern, got [${hits.join(', ')}]`);
  }
});

test('real function assertions match exactly their function', () => {
  for (const [text, expected] of REAL) {
    const hits = [...new Set(matchedLabels(text))];
    assert.deepEqual(hits, [expected], `"${text}" must match only ${expected}, got [${hits.join(', ')}]`);
  }
});

// Antecedent -> function fallback (used only when the patterns above return 'unknown').
test('antecedent inference maps each antecedent to its function', () => {
  const cases = [
    ['RBT presented a demand to sort objects by color', 'Escape'],
    ['Client was asked to move to the next area', 'Escape'],
    ['Transition from toy play activity to puzzle activity', 'Escape'],
    ['asked to complete independent work at the table', 'Escape'],
    ['Preferred item was momentarily withheld to encourage a mand', 'Tangibles'],
    ['Access to the preferred tablet was denied', 'Tangibles'],
    ['RBT momentarily shifted attention to prepare another activity', 'Attention'],
    ['Adult attention was directed toward another student', 'Attention'],
    ['The RBT and caregiver were engaged in conversation', 'Attention'],
    ['No clear external antecedent identified during independent play', 'Automatic Reinforcement'],
    ['Given free play with no social demand', 'Automatic Reinforcement'],
  ];
  for (const [ant, expected] of cases) {
    assert.equal(inferFunctionFromAntecedent(ant), expected, `"${ant}" should infer ${expected}`);
  }
});

test('antecedent inference returns null when nothing matches (never a default)', () => {
  assert.equal(inferFunctionFromAntecedent(''), null);
  assert.equal(inferFunctionFromAntecedent('the client was seated at the table'), null);
});
