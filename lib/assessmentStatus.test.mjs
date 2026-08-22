// Assessment Overview status engine — deterministic checks. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAssessmentStatus } from './assessmentStatus.ts';

const sec = (r, key) => r.sections.find((s) => s.key === key);

const COMPLETE = {
  clientName: 'Alexandra R.',
  diagnosis: ['Autism Spectrum Disorder (F84.0)'],
  maladaptiveBehaviors: [
    { name: 'Elopement', status: 'active', functions: ['escape'], topographies: ['leaves the area without warning'] },
  ],
  replacementBehaviors: [{ name: 'Request Break', status: 'active', targetFunction: 'escape' }],
  interventions: [{ name: 'Differential Reinforcement of Alternative Behavior (DRA)', status: 'active' }],
  reinforcers: ['tablet', 'bubbles'],
  homeActivities: ['puzzles'],
  parentTrainingGoals: ['increase compliance routines'],
};

test('a complete profile is all-green at 100%', () => {
  const r = computeAssessmentStatus(COMPLETE);
  assert.equal(r.overallPct, 100);
  assert.equal(r.redCount, 0);
  assert.equal(r.yellowCount, 0);
  for (const s of r.sections) assert.equal(s.status, 'green', `${s.key} should be green`);
});

test('empty profile → required sections RED, overall low', () => {
  const r = computeAssessmentStatus({});
  assert.equal(sec(r, 'demographics').status, 'red');
  assert.equal(sec(r, 'behaviors').status, 'red');
  assert.equal(sec(r, 'skills').status, 'red');
  assert.equal(sec(r, 'interventions').status, 'red');
  assert.equal(sec(r, 'reinforcers').status, 'red');
  assert.ok(r.overallPct <= 10);
  assert.ok(sec(r, 'behaviors').missing.includes('at least one behavior'));
});

test('behavior missing function or topography → YELLOW with specific issues', () => {
  const r = computeAssessmentStatus({
    ...COMPLETE,
    maladaptiveBehaviors: [
      { name: 'Elopement', status: 'active', functions: [], topographies: ['leaves the area'] },
      { name: 'SIB', status: 'active', functions: ['automatic'], topographies: [] },
    ],
  });
  const b = sec(r, 'behaviors');
  assert.equal(b.status, 'yellow');
  assert.ok(b.issues.some((i) => i.includes('Elopement') && i.includes('no documented function')));
  assert.ok(b.issues.some((i) => i.includes('SIB') && i.includes('no topography')));
});

test('mastered behaviors are name-only and NOT flagged for missing function/topography', () => {
  const r = computeAssessmentStatus({
    ...COMPLETE,
    maladaptiveBehaviors: [
      { name: 'Elopement', status: 'active', functions: ['escape'], topographies: ['leaves the area'] },
      { name: 'Old Behavior', status: 'mastered', functions: [], topographies: [] },
    ],
  });
  assert.equal(sec(r, 'behaviors').status, 'green', 'mastered name-only entry does not lower the status');
});

test('skill without target function, and skill targeting a function no behavior has', () => {
  const r = computeAssessmentStatus({
    ...COMPLETE,
    maladaptiveBehaviors: [{ name: 'Elopement', status: 'active', functions: ['escape'], topographies: ['x'] }],
    replacementBehaviors: [
      { name: 'Request Break', status: 'active', targetFunction: '' },
      { name: 'Ask for Item', status: 'active', targetFunction: 'tangible' }, // no behavior has tangible
    ],
  });
  const s = sec(r, 'skills');
  assert.equal(s.status, 'yellow');
  assert.ok(s.issues.some((i) => i.includes('Request Break') && i.includes('no target function')));
  assert.ok(s.issues.some((i) => i.includes('Ask for Item') && i.includes('no active behavior has that function')));
});

test('interventions: a used function with no fitting approved intervention is flagged (deterministic, via the general map)', () => {
  const r = computeAssessmentStatus({
    ...COMPLETE,
    maladaptiveBehaviors: [{ name: 'Hand Flapping', status: 'active', functions: ['automatic'], topographies: ['x'] }],
    interventions: [{ name: 'Redirection' }, { name: 'Provide Choices' }], // nothing fits automatic {NCR,DRO,DRI,Env Mod}
  });
  const i = sec(r, 'interventions');
  assert.equal(i.status, 'yellow');
  assert.ok(i.issues.some((x) => x.includes('automatic') && x.includes('no approved intervention fits')));
});

test('all-edible reinforcers → YELLOW (none reach notes)', () => {
  const r = computeAssessmentStatus({ ...COMPLETE, reinforcers: ['cookies', 'French fries', 'candy'] });
  const rr = sec(r, 'reinforcers');
  assert.equal(rr.status, 'yellow');
  assert.ok(rr.issues.some((i) => i.includes('every reinforcer is edible')));
});

test('stray-name advisory: a proper name in a topography that is NOT the client is surfaced (heuristic, non-blocking)', () => {
  const r = computeAssessmentStatus({
    ...COMPLETE,
    clientName: 'Brandon T.',
    maladaptiveBehaviors: [
      { name: 'Aggression', status: 'active', functions: ['escape'],
        topographies: ['occurs when Matthew approaches during the task'] }, // stray name from another client
    ],
  });
  const b = sec(r, 'behaviors');
  assert.equal(b.status, 'yellow', 'advisory downgrades green to yellow');
  assert.ok(b.advisories.some((a) => a.includes('Matthew')));
});

test("the client's own name in a topography does NOT trigger a stray-name advisory", () => {
  const r = computeAssessmentStatus({
    ...COMPLETE,
    clientName: 'Alexandra R.',
    maladaptiveBehaviors: [
      { name: 'Elopement', status: 'active', functions: ['escape'],
        topographies: ['any instance of Alexandra leaving the area'] },
    ],
  });
  assert.equal(sec(r, 'behaviors').advisories.length, 0, "own name is not a stray reference");
});

test("own-name exclusion works when clientName is empty and the name is under `name`", () => {
  // real data shape: clientName === "" and name === "Alexandra Juarez"
  const r = computeAssessmentStatus({
    ...COMPLETE,
    clientName: '',
    name: 'Alexandra Juarez',
    maladaptiveBehaviors: [
      { name: 'Elopement', status: 'active', functions: ['escape'],
        topographies: ['any instance of Alexandra moving out of a safe area'] },
    ],
  });
  assert.equal(sec(r, 'behaviors').advisories.length, 0, 'own name (from `name`) must not be flagged as stray');
});

test('judgmentDeferred is populated (checks intentionally not implemented)', () => {
  const r = computeAssessmentStatus(COMPLETE);
  assert.ok(r.judgmentDeferred.length >= 5);
});
