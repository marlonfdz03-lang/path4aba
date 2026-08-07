// Activity-flow firewall (run: `npm test`): the assessment's preferred activities populate both
// home/school lists; the generic hardcoded fallback is removed (never fabricate); Play-Doh is filtered
// from school notes. Marlon's read-time home/school split (commit 0d1b567) is untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClinicalProfile } from './buildClinicalProfile.ts';
import { isValidActivity } from './clinicalFilters.ts';

// The old 5+5 generic fallback strings — none of these may EVER be fabricated into a profile again.
const GENERIC = [
  'structured table activity', 'play-based instruction', 'puzzle activity', 'clean-up routine', 'meal routine',
  'classroom table work', 'group instruction', 'academic worksheet activity', 'peer interaction activity', 'circle time',
];

test('preferred activities populate BOTH home and school lists (flat -> both; read-time split separates)', () => {
  const p = buildClinicalProfile({ preferredActivities: ['water play', 'trampoline', 'Play-Doh'] });
  assert.deepEqual(p.homeActivities, ['water play', 'trampoline', 'Play-Doh']);
  assert.deepEqual(p.schoolActivities, ['water play', 'trampoline', 'Play-Doh']);
});

test('NO generic fallback: no assessment activities -> EMPTY, not fabricated', () => {
  const p = buildClinicalProfile({});
  assert.deepEqual(p.homeActivities, []);
  assert.deepEqual(p.schoolActivities, []);
  const blob = JSON.stringify(p).toLowerCase();
  for (const g of GENERIC) assert.ok(!blob.includes(g.toLowerCase()), `generic "${g}" must never be fabricated`);
});

test('chain order: existing home/school lists win over preferredActivities', () => {
  const p = buildClinicalProfile({ homeActivities: ['puzzles'], schoolActivities: ['circle time'], preferredActivities: ['x'] });
  assert.deepEqual(p.homeActivities, ['puzzles']);
  assert.deepEqual(p.schoolActivities, ['circle time']);
});

test('isValidActivity: Play-Doh filtered from SCHOOL, allowed at HOME (the split addition)', () => {
  assert.equal(isValidActivity('Play-Doh activity', 'school'), false);
  assert.equal(isValidActivity('playdoh', 'school'), false);
  assert.equal(isValidActivity('Play-Doh activity', 'home'), true);
  // existing home-only regression: meal routine still filtered from school
  assert.equal(isValidActivity('meal routine', 'school'), false);
  // a shared activity passes at both (blocklist is permissive — arbitrary assessment activities survive)
  assert.equal(isValidActivity('water play', 'school'), true);
  assert.equal(isValidActivity('water play', 'home'), true);
});

test('NOT over-blocking: toy play / sensory play stay VALID at school (Marlon’s clinical call)', () => {
  assert.equal(isValidActivity('toy play activity', 'school'), true);
  assert.equal(isValidActivity('sensory play', 'school'), true);
});
