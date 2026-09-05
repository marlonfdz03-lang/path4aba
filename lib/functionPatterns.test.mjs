// Regression guard for the FUNCTION_PATTERNS "bare clinical noun" failure class
// (see functionPatterns.ts). Run with: `npm test`  (Node's built-in runner; no deps).
//
// The rule being locked in: a pattern that determines a clinical field must match the
// ASSERTION, not the noun. Every phrase in INNOCENT is ordinary session prose that mentions
// a clinical noun WITHOUT asserting a function — none may match any pattern. Any future
// pattern change that re-introduces a bare-noun match fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUNCTION_PATTERNS, inferFunctionFromAntecedent, findFunctionAntecedentContradictions,
  findMissingFunctionABCs, abcSectionBoundary,
} from './functionPatterns.ts';

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
  // A directed transition + a fine-motor activity is a demand context, NOT a function assertion.
  // It must not read as automatic (or any) function — the bug that made throwing "automatic".
  'transition from a fine motor task',
  'during activities requiring sustained fine motor engagement',
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

// Post-generation coherence: an automatic function asserted in the SAME clause as a social
// antecedent is contradictory and must be flagged for review (never silently returned).
test('automatic + social antecedent in one clause is flagged as a contradiction', () => {
  const contradictory = [
    // The exact shipped bug: directed transition + "automatic reinforcement / no social antecedent".
    'During the transition from a fine motor task to a structured table activity, the client threw an object, consistent with automatic reinforcement, as no clear social antecedents were identified.',
    'When the demand was presented, the client engaged in throwing, consistent with automatic reinforcement.',
    'After a preferred item was removed from the client, the behavior occurred, consistent with automatic reinforcement.',
  ];
  for (const note of contradictory) {
    const flags = findFunctionAntecedentContradictions(note);
    assert.equal(flags.length, 1, `"${note.slice(0, 60)}…" must produce one contradiction flag`);
  }
});

test('coherent automatic clauses are NOT flagged (bare time-marker transition is fine)', () => {
  const coherent = [
    'During independent play with no social demand present, the client engaged in hand flapping, consistent with automatic reinforcement.',
    'During transitions between activities, the client hummed repetitively, consistent with automatic reinforcement.',
    'When the demand was presented, the client engaged in throwing, consistent with escape-maintained behavior.',
  ];
  for (const note of coherent) {
    assert.deepEqual(findFunctionAntecedentContradictions(note), [], `"${note.slice(0, 60)}…" must NOT be flagged`);
  }
});

// ── Characterization: findMissingFunctionABCs behavior is preserved across the abcSegmentation extraction.
// A well-formed two-behavior note (each ABC names its function before the intervention clause, and a skill
// name closes the ABC section) must read as segmentable with nothing missing; a note with no behavior
// keyword must read as unsegmentable. abcSectionBoundary must agree (a number for the former, null for the
// latter).
const SEGMENTABLE_NOTE =
  'During the session the client engaged in Elopement, consistent with the documented escape function, ' +
  'before the RBT implemented DRA. Later Aggression occurred, consistent with the documented attention ' +
  'function, after which the RBT provided DRO. Requesting a Break was targeted as the replacement skill.';
const SEG_BEHAVIORS = [{ name: 'Elopement' }, { name: 'Aggression' }];
const SEG_SKILLS = ['Requesting a Break'];

test('findMissingFunctionABCs: well-formed ABCs segment and report nothing missing', () => {
  const cov = findMissingFunctionABCs(SEGMENTABLE_NOTE, SEG_BEHAVIORS, SEG_SKILLS);
  assert.equal(cov.segmentable, true);
  assert.deepEqual(cov.missing, []);
  assert.equal(typeof abcSectionBoundary(SEGMENTABLE_NOTE, SEG_BEHAVIORS, SEG_SKILLS), 'number');
});

test('findMissingFunctionABCs: a note with no behavior keyword is unsegmentable (fail loud)', () => {
  const cov = findMissingFunctionABCs('The weather was pleasant and the room was quiet today.', SEG_BEHAVIORS, SEG_SKILLS);
  assert.equal(cov.segmentable, false);
  assert.deepEqual(cov.missing, []);
  assert.equal(abcSectionBoundary('The weather was pleasant and the room was quiet today.', SEG_BEHAVIORS, SEG_SKILLS), null);
});

// ── CONTRACT BATTERY — the guard for the abcSegmentation extraction. These 18 inputs exercise every branch
// of findMissingFunctionABCs (guard returns, anchoring, skill-name vs transition-marker boundary, function
// present/missing/misplaced, behavior count/order, skill-name normalization). Each `expected` was VERIFIED
// OUTPUT-IDENTICAL against the pre-refactor (monolithic) function on 2026-09-05, so it pins the exact contract
// the extraction had to preserve. It is a contract test, NOT a frozen copy of the old function: when we change
// the contract on purpose, we update the expectations here — a frozen old-function copy would instead rot into
// a lie the first such time.
const CB_B1 = [{ name: 'Elopement' }];
const CB_B2 = [{ name: 'Elopement' }, { name: 'Aggression' }];
const CB_B2T = [{ name: 'Elopement', topography: 'leaving the area' }, { name: 'Aggression', topography: 'hitting' }];
const CB_B7 = ['Elopement', 'Aggression', 'Tantrum', 'Throwing', 'Screaming', 'Biting', 'Spitting'].map((n) => ({ name: n }));
const CB_WELLFORMED = SEGMENTABLE_NOTE;
const CB_MISPLACED =
  'The client engaged in Elopement, consistent with the documented escape function, before the RBT implemented DRA. ' +
  'Aggression occurred and the RBT provided DRO, which was consistent with the documented attention function. ' +
  'Requesting a Break was targeted as the replacement skill.';
const CB_MISSINGFN =
  'The client engaged in Elopement, consistent with the documented escape function, before the RBT implemented DRA. ' +
  'Aggression occurred and the RBT provided DRO. Requesting a Break was targeted as the replacement skill.';
const CB_TRANSITION =
  'The client engaged in Elopement, consistent with the documented escape function, before the RBT implemented DRA. ' +
  'The replacement skill targeted this session was practiced afterward.';

const UNSEG = { segmentable: false, missing: [], results: [] };

const CONTRACT_BATTERY = [
  ['empty note', '', CB_B2, ['Requesting a Break'], UNSEG],
  ['null note', null, CB_B2, ['Requesting a Break'], UNSEG],
  ['no behaviors', CB_WELLFORMED, [], ['Requesting a Break'], UNSEG],
  ['null behaviors', CB_WELLFORMED, null, ['Requesting a Break'], UNSEG],
  ['no sentences (whitespace)', '   \n  ', CB_B2, ['Requesting a Break'], UNSEG],
  ['no behavior keyword present', 'The weather was pleasant and the room was quiet today.', CB_B2, ['Requesting a Break'], UNSEG],
  ['well-formed 2 behaviors', CB_WELLFORMED, CB_B2, ['Requesting a Break'],
    { segmentable: true, missing: [], results: [{ name: 'Elopement', present: true }, { name: 'Aggression', present: true }] }],
  ['well-formed 2 behaviors w/ topography', CB_WELLFORMED, CB_B2T, ['Requesting a Break'],
    { segmentable: true, missing: [], results: [{ name: 'Elopement', present: true }, { name: 'Aggression', present: true }] }],
  ['well-formed 1 behavior', CB_WELLFORMED, CB_B1, ['Requesting a Break'],
    { segmentable: true, missing: [], results: [{ name: 'Elopement', present: true }] }],
  ['misplaced function (after intervention)', CB_MISPLACED, CB_B2, ['Requesting a Break'],
    { segmentable: true, missing: [{ name: 'Aggression' }], results: [{ name: 'Elopement', present: true }, { name: 'Aggression', present: false }] }],
  ['missing function in 2nd window', CB_MISSINGFN, CB_B2, ['Requesting a Break'],
    { segmentable: true, missing: [{ name: 'Aggression' }], results: [{ name: 'Elopement', present: true }, { name: 'Aggression', present: false }] }],
  ['no skill name, no marker -> unsegmentable', CB_WELLFORMED, CB_B2, [], UNSEG],
  // The transition-marker phrasing here does NOT match SKILL_TRANSITION_MARKERS, so with no skill name the
  // ABC-section end can't be located -> unsegmentable. Pinned as-is (this is the pre-refactor behavior).
  ['transition phrasing that does not match a marker -> unsegmentable', CB_TRANSITION, CB_B1, [], UNSEG],
  ['skill name absent from note -> unsegmentable', CB_WELLFORMED, CB_B2, ['Nonexistent Skill Name'], UNSEG],
  ['7 behaviors, only 2 present', CB_WELLFORMED, CB_B7, ['Requesting a Break'],
    { segmentable: true,
      missing: [{ name: 'Tantrum' }, { name: 'Throwing' }, { name: 'Screaming' }, { name: 'Biting' }, { name: 'Spitting' }],
      results: [
        { name: 'Elopement', present: true }, { name: 'Aggression', present: true }, { name: 'Tantrum', present: false },
        { name: 'Throwing', present: false }, { name: 'Screaming', present: false }, { name: 'Biting', present: false },
        { name: 'Spitting', present: false },
      ] }],
  ['behaviors reversed order', CB_WELLFORMED, [...CB_B2].reverse(), ['Requesting a Break'],
    { segmentable: true, missing: [], results: [{ name: 'Aggression', present: true }, { name: 'Elopement', present: true }] }],
  ['skillNames with short/empty entries', CB_WELLFORMED, CB_B2, ['', 'ab', 'Requesting a Break'],
    { segmentable: true, missing: [], results: [{ name: 'Elopement', present: true }, { name: 'Aggression', present: true }] }],
  ['skillNames whitespace + case', CB_WELLFORMED, CB_B2, ['  REQUESTING A BREAK  '],
    { segmentable: true, missing: [], results: [{ name: 'Elopement', present: true }, { name: 'Aggression', present: true }] }],
];

test('findMissingFunctionABCs: full-branch contract battery (guards the abcSegmentation extraction)', () => {
  for (const [label, note, behaviors, skills, expected] of CONTRACT_BATTERY) {
    assert.deepEqual(findMissingFunctionABCs(note, behaviors, skills), expected, `contract broken on "${label}"`);
  }
});
