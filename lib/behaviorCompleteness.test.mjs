// Assessment partial-accept: an active behavior missing its operational definition (topography) and/or a
// documented function is APPLIED but not documentable. This proves the shared predicate and, critically,
// the SERVER BACKSTOP — a UI-only greying is not enforcement. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  behaviorMissingFields, behaviorIsComplete, incompleteBehaviorNameSet,
  activeBehaviorsForSelection, keepActiveBehaviorNames,
} from './activePrograms.ts';

const complete = { name: 'Aggression', status: 'active', functions: ['escape'], topographies: ['hitting'] };
const noTopo   = { name: 'Inappropriate touching', status: 'active', functions: ['attention'], topographies: [] };
const noFunc   = { name: 'Elopement', status: 'active', functions: [], topographies: ['leaving area'] };
const noBoth   = { name: 'Tantrums', status: 'active' };
const mastered = { name: 'Old', status: 'mastered', functions: [], topographies: [] };

test('predicate: complete behavior has no missing fields', () => {
  assert.deepEqual(behaviorMissingFields(complete), []);
  assert.equal(behaviorIsComplete(complete), true);
});

test('predicate: names exactly what is missing (topography, function, or both)', () => {
  assert.deepEqual(behaviorMissingFields(noTopo), ['topography']);
  assert.deepEqual(behaviorMissingFields(noFunc), ['function']);
  assert.deepEqual(behaviorMissingFields(noBoth).sort(), ['function', 'topography']);
});

test('predicate: accepts the legacy singular `topography`/`function` shapes', () => {
  assert.equal(behaviorIsComplete({ topography: 'hitting', function: ['escape'] }), true);
  assert.equal(behaviorIsComplete({ topography: '', functions: ['escape'] }), false);
});

test('selection helper: incomplete active behaviors are returned but marked non-selectable with a reason', () => {
  const profile = { maladaptiveBehaviors: [complete, noTopo, mastered] };
  const rows = activeBehaviorsForSelection(profile);
  // mastered is filtered out by activeBehaviors; complete + incomplete remain
  assert.deepEqual(rows.map((r) => r.name).sort(), ['Aggression', 'Inappropriate touching']);
  const good = rows.find((r) => r.name === 'Aggression');
  const bad = rows.find((r) => r.name === 'Inappropriate touching');
  assert.equal(good.incomplete, false);
  assert.equal(good.reason, null);
  assert.equal(bad.incomplete, true);
  assert.match(bad.reason, /operational definition/);
});

test('SERVER BACKSTOP: keepActiveBehaviorNames drops an incomplete behavior even if the client posts it', () => {
  const profile = { maladaptiveBehaviors: [complete, noTopo, noFunc, noBoth] };
  const posted = ['Aggression', 'Inappropriate touching', 'Elopement', 'Tantrums'];
  // only the complete one survives — the three incomplete names are rejected server-side
  assert.deepEqual(keepActiveBehaviorNames(posted, profile), ['Aggression']);
});

test('SERVER BACKSTOP: incompleteBehaviorNameSet is lower-cased and active-scoped', () => {
  const profile = { maladaptiveBehaviors: [noTopo, mastered] };
  const set = incompleteBehaviorNameSet(profile);
  assert.equal(set.has('inappropriate touching'), true);
  assert.equal(set.has('old'), false, 'mastered behaviors are not in the active-incomplete set');
});
