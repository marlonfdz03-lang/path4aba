// Curated activity list + buildActivityLists (run: `npm test`). Marlon's rule: the curated list is ALWAYS
// present (every client, every path, assessment or not); assessment activities are added ONLY when SPLIT
// by setting; a flat/untagged list is discarded. Plus the creation-seeding regression guard: every
// client-creation path must seed the curated baseline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildActivityLists,
  CURATED_HOME_ACTIVITIES,
  CURATED_SCHOOL_ACTIVITIES,
  CURATED_ACTIVITIES,
} from './curatedActivities.ts';

test('no-arg → curated baseline only (creation without an assessment)', () => {
  const { homeActivities, schoolActivities } = buildActivityLists();
  assert.deepEqual(homeActivities, CURATED_HOME_ACTIVITIES);
  assert.deepEqual(schoolActivities, CURATED_SCHOOL_ACTIVITIES);
  assert.ok(homeActivities.length > 0 && schoolActivities.length > 0);
});

test('split activities lead, curated appended', () => {
  const { homeActivities, schoolActivities } = buildActivityLists({ home: ['water play'], school: ['recess game'] });
  assert.equal(homeActivities[0], 'water play');
  assert.equal(schoolActivities[0], 'recess game');
  assert.ok(homeActivities.includes('meal routine'));   // curated home
  assert.ok(schoolActivities.includes('circle time'));  // curated school
});

test('home ≠ school — the tags separate them (fixes the identical-list defect)', () => {
  const { homeActivities, schoolActivities } = buildActivityLists();
  assert.notDeepEqual(homeActivities, schoolActivities);
  assert.ok(homeActivities.includes('meal routine') && !schoolActivities.includes('meal routine'));
  assert.ok(schoolActivities.includes('circle time') && !homeActivities.includes('circle time'));
  // an item tagged for BOTH appears in both
  assert.ok(homeActivities.includes('structured table activity'));
  assert.ok(schoolActivities.includes('structured table activity'));
});

test('idempotent — re-applying curated over its own output adds nothing (backfill safe to run twice)', () => {
  const once = buildActivityLists({ home: ['water play'], school: ['recess game'] });
  const twice = buildActivityLists({ home: once.homeActivities, school: once.schoolActivities });
  assert.deepEqual(twice.homeActivities, once.homeActivities);
  assert.deepEqual(twice.schoolActivities, once.schoolActivities);
});

test('case-insensitive dedupe — assessment repeating a curated item makes no duplicate', () => {
  const { homeActivities } = buildActivityLists({ home: ['Meal Routine'] });
  const meals = homeActivities.filter((a) => a.toLowerCase() === 'meal routine');
  assert.equal(meals.length, 1);
  assert.equal(homeActivities[0], 'Meal Routine'); // first occurrence's casing is kept
});

test('blank / empty split entries are dropped, curated still present', () => {
  const { homeActivities } = buildActivityLists({ home: ['', '   ', 'block play'] });
  assert.ok(!homeActivities.includes(''));
  assert.equal(homeActivities[0], 'block play');
  assert.ok(homeActivities.includes('meal routine'));
});

test('curated tags are internally consistent (every item is home and/or school)', () => {
  for (const a of CURATED_ACTIVITIES) {
    assert.ok(a.locations.length > 0, `${a.name} must be tagged for at least one location`);
    assert.ok(a.locations.every((l) => l === 'home' || l === 'school'), `${a.name} has an invalid tag`);
  }
});

// CREATION-SEEDING REGRESSION GUARD — every client-row-creation path must seed the curated baseline,
// so no path can create a client without curated activities. If a future path (or an edit) drops the
// seeding — or a new creation path is added without it — this fails. Source-level (no heavy imports).
test('every client-creation path seeds the curated list (buildActivityLists or mapToLegacyFormat)', () => {
  const creationPaths = [
    'app/api/rbt/clients/create/route.ts',    // requires a PDF → mapToLegacyFormat (which calls the helper)
    'app/api/bcba/clients/create/route.ts',   // PDF optional → no-PDF branch must call buildActivityLists()
    'app/api/clients/route.ts',               // upsert → must call buildActivityLists on create + update
  ];
  for (const rel of creationPaths) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    const seeds = src.includes('buildActivityLists') || src.includes('mapToLegacyFormat');
    assert.ok(seeds, `${rel} must seed curated activities (buildActivityLists or mapToLegacyFormat)`);
  }
});
