// Locks geometry↔LLM behavior reconciliation (see behaviorReconcile.ts). Run: `npm test`
// (Node's built-in runner; no deps).
//
// Real regression from Alexandra's July 2026 reassessment: geometry mangled SIB's name to "SIB (Self- Injury"
// (word order differs from the LLM's "Self-Injury Behaviors (SIB)", so the old substring matcher failed) and
// left "Defiant Behavior" as "(unresolved)" (its name wasn't in the left column, only its definition was).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchByName, matchByDefinition } from './behaviorReconcile.ts';

// An LLM behavior list resembling Alexandra's (clean names + operational definitions).
const LLM = [
  { name: 'Self-Injury Behaviors (SIB)', topographies: ['Defined as any instance where the client slaps her head repeatedly, hits herself with an open or closed fist.'] },
  { name: 'Defiant Behavior', topographies: ['Defined as any observable verbal statement emitted by the client making contradictory statements and engaging in neutral or task-related behavior.'] },
  { name: 'Elopement', topographies: ['Defined as any instance of the client moving out of supervised boundaries without permission.'] },
  { name: 'Property Destruction', topographies: ['Defined as any instance of the client hitting or kicking any item or throwing objects.'] },
];

test('FIX 2: mangled/re-ordered name resolves by token-subset (SIB), old substring match would fail', () => {
  // geometry name after hyphen-rejoin; norm → "sib self injury", LLM → "self injury behaviors sib" (order differs)
  const m = matchByName('SIB (Self-Injury', LLM);
  assert.ok(m, 'should match');
  assert.equal(m.name, 'Self-Injury Behaviors (SIB)'); // adopts the LLM clean name
  assert.match(m.topographies[0], /slaps her head|open or closed fist/); // attaches the real topography
});

test('FIX 2: exact/clean geometry name still matches', () => {
  assert.equal(matchByName('Elopement', LLM)?.name, 'Elopement');
});

test('FIX 3a: unnamed block resolves by DISCRIMINATING definition tokens (Defiant)', () => {
  // the geometry anchor neighborhood for the "(unresolved)" block:
  const defText = 'The behavior ends when the client ceases making contradictory statements and engages in neutral or task-related behavior for 10 consecutive seconds.';
  const m = matchByDefinition(defText, LLM);
  assert.ok(m, 'should resolve via definition');
  assert.equal(m.name, 'Defiant Behavior');
});

test('FIX 3a: name match takes precedence — definition is only the fallback', () => {
  assert.equal(matchByName('(unresolved)', LLM), null); // "(unresolved)" never name-matches → falls to definition
});

test('OVER-MATCH SAFETY: a name matching ≥2 LLM behaviors attaches NOTHING', () => {
  const ambiguous = [{ name: 'Aggression toward peers' }, { name: 'Aggression toward adults' }];
  assert.equal(matchByName('Aggression', ambiguous), null); // token-subset hits both → refuse
});

test('OVER-MATCH SAFETY: a definition pointing at ≥2 behaviors attaches NOTHING', () => {
  // filler-only text: "instance"/"client"/"defined" appear in every topography → not discriminating → no owner
  const m = matchByDefinition('Defined as any instance where the client engages in behavior.', LLM);
  assert.equal(m, null);
});

test('DOMINANT match survives noisy definition text (rubric interleaved): the clear winner still resolves', () => {
  // Defiant's own distinctive words (verbal/statement/contradictory) + scattered single tokens from a shared
  // scoring rubric that each happen to be distinctive to another behavior (slaps→SIB, throwing→Property).
  const noisy = 'Onset: the client emits a contradictory verbal statement. 3=Total interruption; slaps; throwing.';
  assert.equal(matchByDefinition(noisy, LLM)?.name, 'Defiant Behavior'); // 3 Defiant tokens > 1 each elsewhere
});

test('EVIDENCE FLOOR: a single incidental distinctive token does NOT match', () => {
  // "throwing" is distinctive to Property Destruction, but one token alone is not enough evidence.
  assert.equal(matchByDefinition('The client was observed throwing.', LLM), null);
});

test('TIE: two behaviors equally distinctive → refuse (no guess)', () => {
  // SIB: "slaps","fist" (2 distinct) vs Elopement: "moving","boundaries" (2 distinct) — 2-2 tie → null.
  assert.equal(matchByDefinition('slaps with a fist; moving past boundaries.', LLM), null);
});

test('GENUINELY UNRESOLVABLE: no name match and no discriminating definition → null (guard will hard-422)', () => {
  assert.equal(matchByName('Skin Picking', LLM), null);
  assert.equal(matchByDefinition('Client picks at skin around the fingernails until tissue damage occurs.', LLM), null);
});

test('NO over-match on unrelated behaviors: Property Destruction definition does not resolve to SIB/Defiant', () => {
  const m = matchByDefinition('Any instance of the client kicking any item or throwing objects across the room.', LLM);
  assert.equal(m?.name, 'Property Destruction');
});

test('empty / nullish inputs are safe', () => {
  assert.equal(matchByName('', LLM), null);
  assert.equal(matchByName('SIB', []), null);
  assert.equal(matchByDefinition('', LLM), null);
  assert.equal(matchByDefinition('text', []), null);
});
