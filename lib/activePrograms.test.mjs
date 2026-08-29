// Mastered programs must not be offered as selectable for a note (clinical bug). Run: `npm test`.
// The contract: only ACTIVE behaviors/skills are selectable; mastered items are filtered from the note-form
// lists and dropped by the server backstop — but never removed from the profile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeBehaviors, activeSkills, keepActiveBehaviorNames, keepActiveSkillNames,
  masteredSkillNameSet, masteredBehaviorNameSet,
} from './activePrograms.ts';

const PROFILE = {
  maladaptiveBehaviors: [
    { name: 'Throwing Objects', status: 'active', functions: ['escape'], topographies: ['throwing items'] },
    { name: 'Old Tantrum', status: 'mastered', functions: ['attention'] }, // inline mastered
  ],
  masteredBehaviors: ['Hand Flapping'], // separate mastered array
  replacementBehaviors: [{ name: 'Break Request', status: 'active' }],
  skillAcquisition: [{ name: 'Toilet Training', status: 'mastered' }], // mastered skills
  activePrograms: { replacementSkills: ['Break Request', 'Toilet Training'] }, // note: mastered name leaked here
};

test('active behaviors exclude inline-mastered and the masteredBehaviors array', () => {
  const beh = activeBehaviors(PROFILE.maladaptiveBehaviors, PROFILE);
  assert.deepEqual(beh.map((b) => b.name), ['Throwing Objects']);
  // A masteredBehaviors name that somehow appears in the list is also excluded.
  const withLeak = activeBehaviors([...PROFILE.maladaptiveBehaviors, { name: 'Hand Flapping', status: 'active' }], PROFILE);
  assert.ok(!withLeak.some((b) => b.name === 'Hand Flapping'), 'a masteredBehaviors name is excluded even if marked active');
});

test('active skills exclude skillAcquisition (mastered), even when merged with the active list', () => {
  const merged = [...PROFILE.replacementBehaviors, ...PROFILE.skillAcquisition];
  const skills = activeSkills(merged, PROFILE);
  assert.deepEqual(skills.map((s) => s.name), ['Break Request'], 'Toilet Training (mastered) is removed');
  // The mastered name leaked into activePrograms.replacementSkills is also excluded by name.
  const withLeak = activeSkills(['Break Request', 'Toilet Training'], PROFILE);
  assert.deepEqual(withLeak, ['Break Request']);
});

test('server backstop drops mastered selected names (UI-only filter is not a filter)', () => {
  assert.deepEqual(keepActiveBehaviorNames(['Throwing Objects', 'Old Tantrum', 'Hand Flapping'], PROFILE), ['Throwing Objects']);
  assert.deepEqual(keepActiveSkillNames(['Break Request', 'Toilet Training'], PROFILE), ['Break Request']);
});

test('the mastered SETS are correct (used by both UI filter and server backstop)', () => {
  assert.deepEqual([...masteredBehaviorNameSet(PROFILE)].sort(), ['hand flapping', 'old tantrum']);
  assert.deepEqual([...masteredSkillNameSet(PROFILE)].sort(), ['toilet training']);
});

test('a profile with no mastered items leaves everything selectable', () => {
  const clean = { maladaptiveBehaviors: [{ name: 'A', status: 'active' }], replacementBehaviors: [{ name: 'S', status: 'active' }] };
  assert.deepEqual(activeBehaviors(clean.maladaptiveBehaviors, clean).map((b) => b.name), ['A']);
  assert.deepEqual(activeSkills(clean.replacementBehaviors, clean).map((s) => s.name), ['S']);
});
