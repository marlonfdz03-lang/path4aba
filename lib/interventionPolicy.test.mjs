// Regression battery for the treatment-plan intervention gate (see interventionPolicy.ts).
// Run with: `npm test` (Node's built-in runner; no deps).
//
// Locks in the compliance invariant: a note may document ONLY interventions in the
// client's approved plan, and NEVER a hard-prohibited procedure (RIRD). Also guards the
// bare-noun direction: generic "redirection" narrative must not be read as RIRD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectInterventions, findInterventionViolations } from './interventionPolicy.ts';

const RIRD_NOTE =
  'When the demand was presented, the client engaged in throwing; the RBT implemented ' +
  'response interruption and redirection (RIRD) to interrupt the behavior.';

const DRA_FCT_NOTE =
  'When access to a preferred item was denied, the client engaged in tantrum behavior; ' +
  'the RBT implemented DRA by reinforcing functional communication training (FCT).';

test('RIRD is always a violation, even when an approved list is present', () => {
  const v = findInterventionViolations(RIRD_NOTE, ['DRA', 'FCT', 'Premack']);
  assert.ok(v.prohibited.includes('RIRD'), 'RIRD must be flagged as prohibited');
});

test('RIRD is caught even with NO approved list captured', () => {
  const v = findInterventionViolations(RIRD_NOTE, []);
  assert.ok(v.prohibited.includes('RIRD'), 'RIRD must be flagged with no approved list');
  assert.deepEqual(v.unapproved, [], 'no approved list -> no closed-set check');
});

test('an intervention absent from the approved list is flagged as unapproved', () => {
  // Note documents Premack; the plan approves only DRA + FCT.
  const note = DRA_FCT_NOTE + ' The RBT also used the Premack principle to sequence tasks.';
  const v = findInterventionViolations(note, ['DRA', 'FCT']);
  assert.ok(v.unapproved.includes('Premack'), 'Premack must be flagged as unapproved');
  assert.ok(!v.unapproved.includes('DRA') && !v.unapproved.includes('FCT'), 'approved ones pass');
});

test('a note using only approved interventions has no violations', () => {
  const v = findInterventionViolations(DRA_FCT_NOTE, ['DRA', 'FCT']);
  assert.deepEqual(v.prohibited, []);
  assert.deepEqual(v.unapproved, []);
});

test('generic "redirection" narrative is NOT read as RIRD (bare-noun guard)', () => {
  const innocent = [
    'the client completed 3 of 5 puzzle pieces before requiring redirection',
    'the RBT provided a brief verbal redirect and the client resumed the activity',
    'required repeated redirections before reengaging with materials',
  ];
  for (const text of innocent) {
    const detected = detectInterventions(text);
    assert.ok(!detected.includes('RIRD'), `"${text}" must not detect RIRD, got [${detected.join(', ')}]`);
    const v = findInterventionViolations(text, ['DRA', 'FCT']);
    assert.deepEqual(v.prohibited, [], `"${text}" must not be a prohibited violation`);
  }
});

// The long-tail additions: each must be detected when asserted as a named procedure, so the allowlist
// can exclude it when it is not in the client's approved set.
test('long-tail interventions are detected when asserted as a named procedure', () => {
  const cases = [
    ['the RBT implemented a token economy exchanged for a preferred item', 'Token Economy'],
    ['skills were taught through incidental teaching during play', 'Incidental Teaching'],
    ['the RBT used behavioral skills training (BST) to teach the routine', 'Behavioral Skills Training'],
    ['the multi-step task was taught using backward chaining', 'Chaining'],
    ['a task analysis broke the routine into discrete steps', 'Task Analysis'],
    ['compliance training was implemented for instruction-following', 'Compliance Training'],
    ['social skills training (SST) targeted peer interaction', 'Social Skills Training'],
    ['competing stimuli were provided to reduce the automatic behavior', 'Competing Stimuli'],
    ['generalization training extended the skill across settings', 'Generalization Training'],
  ];
  for (const [text, canonical] of cases) {
    assert.ok(detectInterventions(text).includes(canonical), `"${text}" should detect ${canonical}`);
  }
});

// A long-tail intervention absent from the approved set is now catchable (the point of adding them).
test('a long-tail intervention not in the approved set is flagged as unapproved', () => {
  const note = 'the RBT implemented a token economy; the client earned tokens for on-task behavior.';
  const v = findInterventionViolations(note, ['DRA', 'FCT']);
  assert.ok(v.unapproved.includes('Token Economy'), 'Token Economy must be flagged as unapproved');
});

// The DELIBERATELY EXCLUDED bare-noun procedures must never match ordinary session prose (AGENTS.md).
test('excluded bare-noun interventions do NOT match innocent prose', () => {
  const innocent = [
    'the RBT modeled the target response and the client imitated',
    'the client was shaping approximations of the target sound',
    'the client required additional prompting to initiate the task',
    'the client made a choice between two preferred activities',
    'visual supports were available in the room throughout the session',
    'the client completed the chain of steps independently',
  ];
  for (const text of innocent) {
    const detected = detectInterventions(text);
    assert.deepEqual(detected, [], `"${text}" must detect no intervention, got [${detected.join(', ')}]`);
  }
});
