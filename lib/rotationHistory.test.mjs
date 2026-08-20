// Shared generation-history reader (Commit 3). Run: `npm test`.
//
// The load-bearing contract: KNOWN vs UNKNOWN. An axis is reported only when the row actually recorded it.
// A legacy row (no generation_context) never stored activities_used, so its activities are UNKNOWN
// (undefined) — NOT an empty list — so the rotation engine can never treat every activity as "unused"
// purely because of a historical storage limitation. Pure functions, injected rows, no DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNoteContext, mapRowsToHistory } from './rotationHistory.ts';

test('empty history: no rows → empty history array', () => {
  assert.deepEqual(mapRowsToHistory([]), []);
});

test('generation_context present → used verbatim (authoritative), every axis KNOWN', () => {
  const row = {
    note_text: 'irrelevant when the context is present',
    behaviors_addressed: ['Throwing Objects'],
    skills_addressed: ['Break Request'],
    interventions_used: ['STALE — should be ignored in favor of the context'],
    activities_used: [],
    created_at: '2026-08-19T00:00:00Z',
    generation_context: {
      perBehavior: {
        'Throwing Objects': {
          function: 'escape', antecedentKey: 'demand-task', interventionName: 'DRA',
          promptKey: 'verbal', responseKey: 'partial-success', activity: 'puzzle activity',
        },
      },
      perSkill: { 'Break Request': { method: 'Modeling', promptKey: 'model', responseKey: 'prompted-success', activity: 'structured table activity' } },
      activities: ['puzzle activity', 'structured table activity'],
    },
  };
  const ctx = buildNoteContext(row);
  assert.equal(ctx.source, 'generation_context');
  assert.equal(ctx.perBehavior['Throwing Objects'].function, 'escape');
  assert.equal(ctx.perBehavior['Throwing Objects'].promptKey, 'verbal');
  assert.equal(ctx.perBehavior['Throwing Objects'].activity, 'puzzle activity');
  assert.equal(ctx.perSkill['Break Request'].method, 'Modeling');
  assert.equal(ctx.perSkill['Break Request'].activity, 'structured table activity');
  assert.deepEqual(ctx.activities, ['puzzle activity', 'structured table activity']);
  // Interventions come from the context's own choices, not the stale flat list.
  assert.deepEqual(ctx.interventions, ['DRA']);
});

test('derivation fallback: no generation_context → function derived from note_text', () => {
  const row = {
    note_text:
      'During group work the client began throwing objects, consistent with the documented escape function; the RBT redirected.',
    behaviors_addressed: ['throwing objects'],
    skills_addressed: [],
    interventions_used: ['DRA'],
    activities_used: [],
    created_at: '2026-08-18T00:00:00Z',
    generation_context: null,
  };
  const ctx = buildNoteContext(row);
  assert.equal(ctx.source, 'derived');
  assert.equal(ctx.perBehavior['throwing objects']?.function, 'escape', 'function derived from the prose');
  // Nothing else per-behavior is derivable — those axes stay UNKNOWN (absent), never guessed.
  assert.equal(ctx.perBehavior['throwing objects']?.interventionName, undefined);
  assert.equal(ctx.perBehavior['throwing objects']?.promptKey, undefined);
  assert.equal(ctx.perBehavior['throwing objects']?.activity, undefined);
  // interventions IS persisted by the legacy save route → KNOWN at the note level.
  assert.deepEqual(ctx.interventions, ['DRA']);
});

test('MARLON REQUIRED: legacy empty activities_used is UNKNOWN, never evidence for the activity axis', () => {
  const legacy = {
    note_text: 'The client tapped the table, consistent with the documented automatic-reinforcement function.',
    behaviors_addressed: ['Fidgeting'],
    skills_addressed: [],
    interventions_used: ['Redirection'],
    activities_used: [], // the legacy save route NEVER wrote this — empty means "unstored", not "none used"
    created_at: '2026-08-17T00:00:00Z',
    generation_context: null,
  };
  const ctx = buildNoteContext(legacy);
  assert.equal(ctx.activities, undefined,
    'activities must be UNDEFINED (unknown) for a legacy row — not [] — so it contributes nothing to LRU');
  // A genuinely different reason to have no activities can only come from a generation_context note, where
  // an explicit empty list would be KNOWN. Legacy can never assert that.
  assert.notEqual(ctx.activities, null);
});

test('history shorter than the window: maps exactly the rows given, newest-first order preserved', () => {
  const rows = [
    { note_text: 'a', behaviors_addressed: [], generation_context: { perBehavior: {}, perSkill: {}, activities: ['x'] }, created_at: '2026-08-19T00:00:00Z' },
    { note_text: 'b', behaviors_addressed: [], generation_context: { perBehavior: {}, perSkill: {}, activities: ['y'] }, created_at: '2026-08-18T00:00:00Z' },
  ];
  const hist = mapRowsToHistory(rows);
  assert.equal(hist.length, 2, 'a 2-note history (shorter than the 3-window) maps to 2, no padding');
  assert.deepEqual(hist[0].activities, ['x']);
  assert.deepEqual(hist[1].activities, ['y']);
});

test('generation_context activities can be a KNOWN empty list (distinct from legacy unknown)', () => {
  const row = {
    behaviors_addressed: [],
    generation_context: { perBehavior: {}, perSkill: {}, activities: [] },
    created_at: '2026-08-19T00:00:00Z',
  };
  const ctx = buildNoteContext(row);
  assert.deepEqual(ctx.activities, [], 'an explicit empty list in a context note is KNOWN-empty, not unknown');
});
