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

// Commit 3: FCT role-awareness. FCT is a replacement SKILL; documenting it AS a behavior-reduction
// intervention is invalid unless FCT is ALSO an approved reduction intervention.
test('FCT documented as a reduction intervention fails when FCT is only a skill program', () => {
  const note = 'When the client engaged in aggression, the RBT implemented FCT to reduce the behavior.';
  const v = findInterventionViolations(note, ['DRA'], ['FCT - Request for a Break']);
  assert.ok(v.skillAsReduction.includes('FCT'), 'FCT-as-reduction must be flagged');
  assert.ok(!v.unapproved.includes('FCT'), 'it is a skill-role violation, not a plain unapproved');
});

// The FCT-as-skill hard-fail we shipped C for: a role-aware note teaches FCT by prompting the client
// to REQUEST/communicate. The broadened SKILL_CUE must read that as a skill, not a reduction — so a
// client whose FCT is only a skill program no longer hard-fails generation on this exact sentence.
test('FCT taught by prompting the client to request is a skill, not a reduction', () => {
  const notes = [
    'When the demand was presented, the RBT implemented FCT by prompting the client to request a break.',
    'The client practiced requesting attention using functional communication training (FCT).',
    'FCT was used as the client learned to mand for a break instead of engaging in the behavior.',
  ];
  for (const note of notes) {
    const v = findInterventionViolations(note, ['DRA'], ['FCT in the form of requesting attention']);
    assert.deepEqual(v.skillAsReduction, [], `must not flag FCT-as-reduction: "${note}"`);
  }
});

test('FCT documented as a skill being taught passes', () => {
  const note =
    'The RBT targeted FCT (functional communication training) using discrete trial teaching; ' +
    'the client practiced requesting a break.';
  const v = findInterventionViolations(note, ['DRA'], ['FCT - Request for a Break']);
  assert.deepEqual(v.skillAsReduction, [], 'FCT-as-skill must not be flagged');
  assert.deepEqual(v.unapproved, [], 'and a skill program is not "unapproved"');
});

test('FCT as a reduction intervention passes when FCT IS an approved reduction intervention', () => {
  const note = 'When the client engaged in aggression, the RBT implemented FCT to reduce the behavior.';
  const v = findInterventionViolations(note, ['DRA', 'Functional Communication Training'], ['FCT - Request for a Break']);
  assert.deepEqual(v.skillAsReduction, []);
  assert.deepEqual(v.unapproved, []);
});

test('the 2-arg call still works (no skill list -> no role-awareness, backward compatible)', () => {
  const v = findInterventionViolations('the RBT implemented FCT to reduce the behavior', ['DRA']);
  assert.deepEqual(v.skillAsReduction, []);
  assert.ok(v.unapproved.includes('FCT'), 'without a skill list, FCT not in approved -> unapproved');
});

// The autofill safety-net (extract-facts) runs this gate over SHORT intervention FIELD strings, not full
// note prose, then blanks any offending field. Lock the contract that reuse depends on: a bare field
// value is gated the same way — prohibited caught with no approved list, unapproved caught with one.
test('intervention field strings are gated (extract-facts autofill reuse)', () => {
  assert.ok(findInterventionViolations('RIRD', []).prohibited.includes('RIRD'),
    'a prohibited procedure in a bare field is caught even with no approved list');
  const ok = findInterventionViolations('DRA', ['DRA', 'FCT']);
  assert.deepEqual(ok.prohibited, []);
  assert.deepEqual(ok.unapproved, []);
  assert.ok(findInterventionViolations('Token Economy', ['DRA']).unapproved.includes('Token Economy'),
    'an unapproved catalog intervention in a bare field is flagged');
  assert.deepEqual(fieldViolationsEmpty(''), [], 'an empty field is clean');
});

// mirror of extract-facts' fieldInterventionViolations (module-private there) — same reduction over the
// three violation buckets, so the test documents exactly what the route blanks a field on.
function fieldViolationsEmpty(text) {
  const v = findInterventionViolations(String(text || ''), [], []);
  return [...new Set([...v.prohibited, ...v.unapproved, ...v.skillAsReduction])];
}

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
