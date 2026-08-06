// Regression for the teaching-method closed set (see teachingMethods.ts). Run: `npm test`.
//
// Invariant: a teaching method named in a note must be in the client's approved set
// (clinical_profile.interventions ∩ teaching-method vocabulary). Seed cases are the three real clients:
// Modeling/DTT are written by the generator but approved for none of them -> must be caught.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedTeachingMethods, findTeachingMethodViolations, deriveTeachingMethod, TEACHING_METHOD_PATTERNS } from './teachingMethods.ts';

const matched = (text) => TEACHING_METHOD_PATTERNS.filter((p) => p.noteRe.test(text)).map((p) => p.canonical);

// AGENTS.md bare-noun guard: method-ish words in ordinary prose that assert NO teaching procedure.
const INNOCENT = [
  'the client played with modeling clay at the sensory table',
  'the parent will model the skill at home',                  // "model" (verb), not "modeling"
  'staff served as a positive role model',
  'the RBT provided verbal prompting and gestural prompts',   // prompt LEVELS, not the "Prompting" method
  'the client was prompted to respond',
  'shaping his understanding of the routine',                  // not the shaping procedure
  'the team analyzed the task demands informally',             // not "task analysis"
];

test('innocent prose asserts NO teaching method (bare-noun guard)', () => {
  for (const text of INNOCENT) {
    assert.deepEqual(matched(text), [], `"${text}" must match no method, got [${matched(text)}]`);
  }
});

test('real method assertions match their method', () => {
  const REAL = [
    ['practiced through Discrete Trial Teaching (DTT)', 'Discrete Trial Training'],
    ['taught using Natural Environment Teaching', 'Natural Environment Teaching'],
    ['addressed via incidental teaching', 'Incidental Teaching'],
    ['using errorless teaching', 'Errorless Teaching'],
    ['practiced using Modeling and visual supports', 'Modeling'],
    ['using Modeling and gestural prompts', 'Modeling'],
    ['taught with video modeling', 'Modeling'],
    ['using a hand-over-hand procedure', 'Hand Over Hand'],
    ['practiced with an activity schedule', 'Activity Schedule'],
    ['using FCT to request a break', 'Functional Communication Training'],
  ];
  for (const [text, method] of REAL) {
    assert.ok(matched(text).includes(method), `"${text}" should name ${method}, got [${matched(text)}]`);
  }
});

// ── Per-client: approved set from real interventions[], and the Modeling/DTT violation ──

// Alexandra (January assessment): rich methods, but NO Modeling and NO DTT.
const ALEXANDRA_IV = ['Differential Reinforcement of Alternative Behavior (DRA)', 'DRI', 'DRO', 'Premack Principle',
  'Escape Extinction', 'Redirection', 'Provide Choices', 'Activity Schedule', 'Incidental Teaching',
  'Hand Over Hand', 'Planned Ignore', 'Behavior Momentum', 'Prompting', 'Errorless Teaching', 'Functional Communication Training'];

test('Alexandra approved method set excludes reduction procedures, includes named methods', () => {
  const set = approvedTeachingMethods(ALEXANDRA_IV);
  assert.ok(set.has('Incidental Teaching') && set.has('Errorless Teaching') && set.has('Activity Schedule')
    && set.has('Hand Over Hand') && set.has('Functional Communication Training'), 'named methods in');
  assert.ok(!set.has('Modeling') && !set.has('Discrete Trial Training'), 'Modeling/DTT NOT approved');
  // DRA/DRO/Premack/Redirection are reduction procedures, not teaching methods -> not in the set.
});

test('Alexandra: a note naming Modeling and DTT is caught (the invention)', () => {
  const note = 'Manding was practiced using Modeling and visual supports. Tacting was addressed through Discrete Trial Teaching (DTT). Waiting was taught with incidental teaching.';
  const v = findTeachingMethodViolations(note, ALEXANDRA_IV);
  assert.deepEqual(v.sort(), ['Discrete Trial Training', 'Modeling'], 'Modeling + DTT flagged, incidental teaching (approved) not');
});

// Felix: sparse — approved methods are FCT only (Systematic Prompting is not in this vocabulary).
test('Felix: note Modeling/DTT caught; FCT allowed', () => {
  const FELIX_IV = ['Differential Reinforcement of Alternative Behavior (DRA)', 'Structured Antecedent Strategies',
    'Reinforcement Systems', 'Systematic Prompting with Fading', 'Functional Communication Training'];
  const note = 'Transition Request practiced using FCT with modeling and gestural prompts, and Task Modification through DTT.';
  const v = findTeachingMethodViolations(note, FELIX_IV);
  assert.ok(v.includes('Modeling') && v.includes('Discrete Trial Training'), 'Modeling + DTT flagged');
  assert.ok(!v.includes('Functional Communication Training'), 'FCT is approved -> not flagged');
});

// A note that names only approved methods has no violation.
test('note using only approved methods -> no violation', () => {
  const note = 'Skills practiced through incidental teaching and errorless teaching with an activity schedule.';
  assert.deepEqual(findTeachingMethodViolations(note, ALEXANDRA_IV), []);
});

// No classifiable approved method -> do not constrain (never block on missing data / vocab gap).
test('empty approved method set -> unconstrained (no false block)', () => {
  assert.deepEqual(findTeachingMethodViolations('practiced using Modeling', ['DRA', 'DRO', 'Escape Extinction']), []);
});

// ── Part 2: deriveTeachingMethod copies the approved method the note stated ──
test('deriveTeachingMethod: copies the approved method named in the prose', () => {
  assert.equal(deriveTeachingMethod('practiced through incidental teaching', ALEXANDRA_IV), 'Incidental Teaching');
  assert.equal(deriveTeachingMethod('taught with an activity schedule', ALEXANDRA_IV), 'Activity Schedule');
});
test('deriveTeachingMethod: an UNAPPROVED method in the prose yields null (never copied to the form)', () => {
  // Even if a hand-written note says Modeling, it is not approved for Alexandra -> not copied.
  assert.equal(deriveTeachingMethod('practiced using Modeling and visual supports', ALEXANDRA_IV), null);
});
test('deriveTeachingMethod: no method named -> null (caller defaults to an approved method or config-gap)', () => {
  assert.equal(deriveTeachingMethod('the client engaged with fidget tools while waiting', ALEXANDRA_IV), null);
  assert.equal(deriveTeachingMethod('practiced using incidental teaching', ['DRA', 'DRO']), null); // empty approved set
});

// The July update: once Modeling is approved, the same note passes -> gate is relative to the live plan.
test('when Modeling becomes approved (assessment update), it is no longer a violation', () => {
  const JULY_IV = [...ALEXANDRA_IV, 'Modeling'];
  assert.deepEqual(findTeachingMethodViolations('practiced using Modeling and visual supports', JULY_IV), []);
});
