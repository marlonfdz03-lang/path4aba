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
test('GUARD 1: a behavior missing its function is rejected AND named', () => {
  const partial = {
    maladaptiveBehaviors: [{ name: 'Elopement', functions: [], topographies: ['leaving area'] }],
    interventions: [{ name: 'FCT' }], reinforcers: ['praise'],
  };
  const problems = validateAssessmentProfile(partial, VALID_EXTRACTED);
  assert.ok(problems.some((p) => p.includes('no function') && p.includes('Elopement')), problems.join(' | '));
});
test('GUARD 1: a behavior missing its topography is rejected AND named', () => {
  const partial = {
    maladaptiveBehaviors: [{ name: 'Aggression', functions: ['escape'], topographies: [] }],
    interventions: [{ name: 'FCT' }], reinforcers: ['praise'],
  };
  const problems = validateAssessmentProfile(partial, VALID_EXTRACTED);
  assert.ok(problems.some((p) => p.includes('no topography') && p.includes('Aggression')), problems.join(' | '));
});
test('GUARD 1: missing replacement skills alone is rejected (assessment is otherwise complete)', () => {
  assert.deepEqual(validateAssessmentProfile(VALID, { replacementSkills: [] }), ['no replacement skills / programs found']);
});

// ── GUARD 1: mastered/discontinued items are EXEMPT from the topography/function requirement (Commit B) ──
test('GUARD 1: a mastered behavior with empty topography/function is NOT a problem (exempt)', () => {
  const p = {
    maladaptiveBehaviors: [
      { name: 'Distractibility', status: 'active', functions: ['escape'], topographies: ['off-task'] },
      { name: 'Aggression', status: 'mastered', functions: [], topographies: [] }, // captured name-only
    ],
    interventions: [{ name: 'DRA' }], reinforcers: ['tokens'],
  };
  assert.deepEqual(validateAssessmentProfile(p, VALID_EXTRACTED), [], 'mastered name-only entry does not 422');
});
test('GUARD 1: a discontinued behavior with empty fields is exempt too', () => {
  const p = {
    maladaptiveBehaviors: [
      { name: 'Elopement', status: 'active', functions: ['escape'], topographies: ['leaving'] },
      { name: 'Old Behavior', status: 'discontinued', functions: [], topographies: [] },
    ],
    interventions: [{ name: 'FCT' }], reinforcers: ['praise'],
  };
  assert.deepEqual(validateAssessmentProfile(p, VALID_EXTRACTED), []);
});
test('GUARD 1: an ACTIVE behavior missing function/topography is STILL a problem (exemption is status-scoped)', () => {
  const p = {
    maladaptiveBehaviors: [{ name: 'Tantrums', status: 'active', functions: [], topographies: [] }],
    interventions: [{ name: 'DRA' }], reinforcers: ['tokens'],
  };
  const problems = validateAssessmentProfile(p, VALID_EXTRACTED);
  assert.ok(problems.some((x) => x.includes('no function') && x.includes('Tantrums')));
  assert.ok(problems.some((x) => x.includes('no topography') && x.includes('Tantrums')));
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
