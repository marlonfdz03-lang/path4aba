// Activity flow (run: `npm test`): the curated clinician-approved list is the ALWAYS-present baseline;
// the assessment contributes activities ONLY when it SPLIT them by setting (home→home, school→school);
// a FLAT/untagged list is DISCARDED (never misplaced into both). isValidActivity still applies the
// read-time home/school split (commit 0d1b567) — untouched here.
//
// NOTE: buildActivityLists unit coverage + the creation-seeding regression guard live in
// curatedActivities.test.mjs. This file covers the profile-builder wiring + the read-time filter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClinicalProfile } from './buildClinicalProfile.ts';
import { isValidActivity } from './clinicalFilters.ts';
import { CURATED_HOME_ACTIVITIES, CURATED_SCHOOL_ACTIVITIES } from './curatedActivities.ts';

test('FLAT preferredActivities is DISCARDED (no home/school tag) → curated baseline only', () => {
  const p = buildClinicalProfile({ preferredActivities: ['water play', 'trampoline', 'Play-Doh'] });
  // Untagged flat activities are not misplaced into both lists.
  assert.ok(!p.homeActivities.includes('water play'));
  assert.ok(!p.schoolActivities.includes('trampoline'));
  assert.deepEqual(p.homeActivities, CURATED_HOME_ACTIVITIES);
  assert.deepEqual(p.schoolActivities, CURATED_SCHOOL_ACTIVITIES);
});

test('no assessment activities → curated baseline (never empty, never invented)', () => {
  const p = buildClinicalProfile({});
  assert.deepEqual(p.homeActivities, CURATED_HOME_ACTIVITIES);
  assert.deepEqual(p.schoolActivities, CURATED_SCHOOL_ACTIVITIES);
  assert.ok(p.homeActivities.length > 0 && p.schoolActivities.length > 0);
});

test('SPLIT activities are placed by setting (home→home, school→school) then curated appended', () => {
  const p = buildClinicalProfile({ homeActivities: ['bath time'], schoolActivities: ['gym class'] });
  assert.equal(p.homeActivities[0], 'bath time');            // real split activity leads
  assert.equal(p.schoolActivities[0], 'gym class');
  assert.ok(p.homeActivities.includes('meal routine'));      // curated home appended
  assert.ok(p.schoolActivities.includes('circle time'));     // curated school appended
  // never cross-placed
  assert.ok(!p.schoolActivities.includes('bath time'));
  assert.ok(!p.homeActivities.includes('gym class'));
});

test('home and school lists are NOT identical (the curated tags separate them)', () => {
  const p = buildClinicalProfile({});
  assert.notDeepEqual(p.homeActivities, p.schoolActivities);
  assert.ok(p.homeActivities.includes('meal routine') && !p.schoolActivities.includes('meal routine'));
  assert.ok(p.schoolActivities.includes('circle time') && !p.homeActivities.includes('circle time'));
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
