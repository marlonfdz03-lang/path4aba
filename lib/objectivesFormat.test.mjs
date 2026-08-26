// objMatch — the reduce-target ↔ Description/Objectives name matcher (containment / acronym / token-subset).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objMatch } from './objectivesFormat.ts';

test('acronym: "SIB" matches "Self Injury Behavior"', () => {
  assert.equal(objMatch('SIB', 'Self Injury Behavior'), true);
  assert.equal(objMatch('Self Injury Behavior', 'SIB'), true);
});

test('containment + token-subset', () => {
  assert.equal(objMatch('Off Task Behavior', 'Off-Task'), true);
  assert.equal(objMatch('Task Refusal', 'task Refusal'), true);
  assert.equal(objMatch('Elopement', 'Elopement'), true);
});

test('does not match unrelated names', () => {
  assert.equal(objMatch('Elopement', 'Tantrum'), false);
  assert.equal(objMatch('SIB', 'Physical Aggression'), false);
});
