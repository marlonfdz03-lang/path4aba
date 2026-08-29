// Proves the Update-Assessment full-refresh guards (see assessmentRefresh.ts). Run: `npm test`.
//
// This is what turns the route's "correct by reading" into "proven": GUARD 1 must 422 (write nothing)
// on a partial/empty extraction so a real profile is never wiped, and GUARD 2 must replace assessment
// keys while preserving everything else + snapshotting the pre-refresh profile for one-level undo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssessmentProfile, buildRefreshedProfile } from './assessmentRefresh.ts';

const VALID = {
  maladaptiveBehaviors: [{ name: 'Distractibility', functions: ['escape', 'automatic'], topographies: ['off-task'] }],
  interventions: [{ name: 'DRA' }],
  reinforcers: ['tokens'],
};
const VALID_EXTRACTED = { replacementSkills: [{ name: 'Request a Break' }] };

// ── GUARD 1: a complete extraction is accepted ───────────────────────────────
test('GUARD 1: a complete assessment yields NO problems (would apply)', () => {
  assert.deepEqual(validateAssessmentProfile(VALID, VALID_EXTRACTED), []);
});

// ── GUARD 1: every failure mode returns a problem -> the route 422s, writes nothing ──
test('GUARD 1: empty extraction (no behaviors/interventions/reinforcers/skills) is rejected', () => {
  const problems = validateAssessmentProfile({ maladaptiveBehaviors: [], interventions: [], reinforcers: [] }, { replacementSkills: [] });
  assert.ok(problems.length >= 4, `expected several problems, got ${problems.length}`);
  assert.ok(problems.some((p) => /no target behaviors/.test(p)));
  assert.ok(problems.some((p) => /no interventions/.test(p)));
  assert.ok(problems.some((p) => /no reinforcers/.test(p)));
  assert.ok(problems.some((p) => /no replacement skills/.test(p)));
});
// PARTIAL-ACCEPT: a per-behavior gap (missing function and/or topography) is NO LONGER fatal — the refresh
// applies the complete behaviors and the route surfaces the incomplete ones as reviewFlags. Only the
// zero-count conditions below stay fatal.
test('PARTIAL-ACCEPT: a behavior missing its function is NOT fatal (applied + flagged, not a 422)', () => {
  const partial = {
    maladaptiveBehaviors: [{ name: 'Elopement', functions: [], topographies: ['leaving area'] }],
    interventions: [{ name: 'FCT' }], reinforcers: ['praise'],
  };
  assert.deepEqual(validateAssessmentProfile(partial, VALID_EXTRACTED), []);
});
test('PARTIAL-ACCEPT: a behavior missing its topography is NOT fatal (applied + flagged, not a 422)', () => {
  const partial = {
    maladaptiveBehaviors: [{ name: 'Aggression', functions: ['escape'], topographies: [] }],
    interventions: [{ name: 'FCT' }], reinforcers: ['praise'],
  };
  assert.deepEqual(validateAssessmentProfile(partial, VALID_EXTRACTED), []);
});
test('GUARD 1: missing replacement skills alone is rejected (assessment is otherwise complete)', () => {
  assert.deepEqual(validateAssessmentProfile(VALID, { replacementSkills: [] }), ['no replacement skills / programs found']);
});

// ── PARTIAL-ACCEPT: a per-behavior gap never 422s, regardless of status. Even a whole active behavior with
//    NO function AND NO topography applies (and is flagged + filtered from note selection elsewhere). ──
test('PARTIAL-ACCEPT: an ACTIVE behavior missing BOTH function and topography is NOT fatal', () => {
  const p = {
    maladaptiveBehaviors: [{ name: 'Tantrums', status: 'active', functions: [], topographies: [] }],
    interventions: [{ name: 'DRA' }], reinforcers: ['tokens'],
  };
  assert.deepEqual(validateAssessmentProfile(p, VALID_EXTRACTED), []);
});
test('PARTIAL-ACCEPT: complete + incomplete behaviors together still apply (Hendrex shape: 1 good, 1 gap)', () => {
  const p = {
    maladaptiveBehaviors: [
      { name: 'Distractibility', status: 'active', functions: ['escape'], topographies: ['off-task'] },
      { name: 'Inappropriate touching', status: 'active', functions: ['attention'], topographies: [] },
    ],
    interventions: [{ name: 'DRA' }], reinforcers: ['tokens'],
  };
  assert.deepEqual(validateAssessmentProfile(p, VALID_EXTRACTED), [], 'the good behavior is not held hostage by the incomplete one');
});
test('GUARD 1: an all-mastered assessment (no active behaviors, mastered present) is not "no target behaviors"', () => {
  const p = { maladaptiveBehaviors: [], masteredBehaviors: ['Aggression', 'Throwing'], interventions: [{ name: 'DRA' }], reinforcers: ['tokens'] };
  assert.deepEqual(validateAssessmentProfile(p, VALID_EXTRACTED), [], 'mastered behaviors count as behaviors found');
});

// ── GUARD 2: valid path replaces assessment keys, preserves the rest, snapshots for undo ──
test('GUARD 2: assessment keys replaced, non-assessment keys preserved, previousProfile snapshotted', () => {
  const existing = {
    maladaptiveBehaviors: [{ name: 'OLD', functions: ['attention'], topographies: ['x'] }], // will be replaced
    interventions: [{ name: 'OLD-IV' }],
    observedCatalog: { aba_matrix: { current: { functions: ['Escape'], functionsByBehavior: { Distractibility: ['Escape', 'Automatic Reinforcement'] } } } },
    blockedNarrativeTerms: [{ term: 'sensory', substitute: null }],
    gender: 'male',
  };
  const assessmentProfile = {
    maladaptiveBehaviors: [{ name: 'Distractibility', functions: ['escape', 'automatic'], topographies: ['off-task'] }],
    interventions: [{ name: 'DRA' }], reinforcers: ['tokens'],
  };
  const refreshed = buildRefreshedProfile(existing, assessmentProfile);

  // assessment-sourced keys REPLACED wholesale
  assert.deepEqual(refreshed.maladaptiveBehaviors, assessmentProfile.maladaptiveBehaviors);
  assert.deepEqual(refreshed.interventions, assessmentProfile.interventions);
  // non-assessment keys PRESERVED (esp. the per-behavior capture the fill depends on)
  assert.deepEqual(refreshed.observedCatalog, existing.observedCatalog, 'observedCatalog/functionsByBehavior survive the refresh');
  assert.deepEqual(refreshed.blockedNarrativeTerms, existing.blockedNarrativeTerms);
  assert.equal(refreshed.gender, 'male');
  // one-level undo snapshot = the whole pre-refresh profile
  assert.deepEqual(refreshed.previousProfile, existing, 'previousProfile is the pre-refresh profile');
});

test('GUARD 2: snapshot never nests — a prior previousProfile is stripped before snapshotting', () => {
  const existing = {
    maladaptiveBehaviors: [{ name: 'A', functions: ['escape'], topographies: ['t'] }],
    interventions: [{ name: 'IV' }],
    previousProfile: { stale: true }, // an earlier snapshot
  };
  const refreshed = buildRefreshedProfile(existing, { maladaptiveBehaviors: [{ name: 'B', functions: ['automatic'], topographies: ['u'] }], interventions: [{ name: 'IV2' }], reinforcers: ['r'] });
  assert.equal(refreshed.previousProfile.previousProfile, undefined, 'no nested/compounding snapshot');
  assert.equal(refreshed.previousProfile.maladaptiveBehaviors[0].name, 'A', 'snapshot is the real prior profile, sans its own prev');
});

// The undo-includes-the-grid guarantee: a future functionalAssessment key rides through the WHOLE-profile
// snapshot untouched, so restoring never strands the FAST/MAS grid.
test('GUARD 2: a future functionalAssessment key is carried into the undo snapshot (not stranded)', () => {
  const existing = {
    maladaptiveBehaviors: [{ name: 'A', functions: ['escape'], topographies: ['t'] }],
    interventions: [{ name: 'IV' }],
    functionalAssessment: { fast: { A: { escape: true } }, mas: {}, union: { A: ['escape'] } },
  };
  const refreshed = buildRefreshedProfile(existing, { maladaptiveBehaviors: [{ name: 'A', functions: ['escape'], topographies: ['t'] }], interventions: [{ name: 'IV' }], reinforcers: ['r'] });
  assert.deepEqual(refreshed.previousProfile.functionalAssessment, existing.functionalAssessment, 'grid is in the undo snapshot');
});

test('GUARD 2: buildRefreshedProfile does NOT mutate the existing profile (byte-for-byte intact)', () => {
  const existing = { maladaptiveBehaviors: [{ name: 'A', functions: ['escape'], topographies: ['t'] }], interventions: [{ name: 'IV' }], gender: 'female' };
  const snapshot = JSON.parse(JSON.stringify(existing));
  buildRefreshedProfile(existing, { maladaptiveBehaviors: [], interventions: [], reinforcers: [] });
  assert.deepEqual(existing, snapshot, 'input profile is untouched — the route holds the original for its 422/unchanged guarantee');
});

test('GUARD 2: a null/undefined existing profile is handled (first-ever assessment)', () => {
  const refreshed = buildRefreshedProfile(null, { maladaptiveBehaviors: [{ name: 'A', functions: ['escape'], topographies: ['t'] }], interventions: [{ name: 'IV' }], reinforcers: ['r'] });
  assert.deepEqual(refreshed.previousProfile, {}, 'no prior profile -> empty snapshot, still one-level-undo-shaped');
  assert.equal(refreshed.maladaptiveBehaviors[0].name, 'A');
});
