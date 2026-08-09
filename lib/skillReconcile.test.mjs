// Locks the cross-field skill reconciliation (see skillReconcile.ts). Run: `npm test`
// (Node's built-in runner; no deps).
//
// The rule: a skill the assessment's MASTERED section declares mastered must not also appear in the active
// replacementBehaviors. The subtraction keys on mastered NAMES via a token-subset match — structural, no
// threshold. Real regression from Brandon's July 2026 assessment: "Compliance with daily living activities"
// and "End structured games appropriately" appeared in both fields (exact), and "Share a toy…" (MASTERED)
// vs "Share a preferred toy…" (active) was a near-dup the old substring match missed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenSubsetMatch, subtractMasteredFromActive } from './skillReconcile.ts';

test('tokenSubsetMatch: exact names match', () => {
  assert.equal(tokenSubsetMatch('Compliance with daily living activities', 'Compliance with daily living activities'), true);
});

test('tokenSubsetMatch: near-dup caught ("Share a toy" ⊆ "Share a preferred toy")', () => {
  assert.equal(tokenSubsetMatch('Share a toy while refraining from engaging in maladaptive',
                                'Share a preferred toy while refraining from engaging in maladaptive'), true);
  // order-independent
  assert.equal(tokenSubsetMatch('Share a preferred toy while refraining from engaging in maladaptive',
                                'Share a toy while refraining from engaging in maladaptive'), true);
});

test('tokenSubsetMatch: does NOT over-merge unrelated short names (distinguishing token differs)', () => {
  assert.equal(tokenSubsetMatch('Share a toy', 'Share a book'), false);
  assert.equal(tokenSubsetMatch('Request a break', 'Request help'), false);
  assert.equal(tokenSubsetMatch('Following Instructions', 'Increasing Time on Task'), false);
});

test('tokenSubsetMatch: empty / whitespace names never match', () => {
  assert.equal(tokenSubsetMatch('', 'Share a toy'), false);
  assert.equal(tokenSubsetMatch('Share a toy', '   '), false);
});

test('subtract: overlap fixture → mastered removed from active, fields DISJOINT', () => {
  const active = [
    { name: 'Socially Appropriate Skills' },
    { name: 'Compliance with daily living activities' },   // ← also mastered → remove
    { name: 'End structured games appropriately' },        // ← also mastered → remove
    { name: 'Share a preferred toy while refraining from engaging in maladaptive' }, // near-dup → remove
    { name: 'Respond to Safety Instructions' },
  ];
  const masteredNames = [
    'Share a toy while refraining from engaging in maladaptive',
    'End structured games appropriately',
    'Compliance with daily living activities',
    'Request a Break Properly',
  ];
  const result = subtractMasteredFromActive(active, masteredNames);
  assert.deepEqual(result.map(x => x.name), ['Socially Appropriate Skills', 'Respond to Safety Instructions']);
  // disjoint: no surviving active name matches any mastered name
  for (const a of result) for (const m of masteredNames)
    assert.equal(tokenSubsetMatch(a.name, m), false, `${a.name} still overlaps ${m}`);
});

test('subtract: innocent fixture (no overlap) → NOTHING removed', () => {
  const active = [{ name: 'Increasing Time on Task' }, { name: 'FCT in the form of requesting attention' }];
  const mastered = ['Request a Break Properly', 'Following Instructions'];
  assert.deepEqual(subtractMasteredFromActive(active, mastered).map(x => x.name),
                   ['Increasing Time on Task', 'FCT in the form of requesting attention']);
});

test('subtract: no mastered set → active returned unchanged (no authoritative MASTERED section)', () => {
  const active = [{ name: 'Compliance with daily living activities' }];
  assert.deepEqual(subtractMasteredFromActive(active, []), active);
  assert.deepEqual(subtractMasteredFromActive(active, null), active);
});

test('subtract: handles string-form entries (display path) and empty/nullish input', () => {
  assert.deepEqual(subtractMasteredFromActive(['Compliance with daily living activities', 'Increasing Time on Task'],
                                              ['Compliance with daily living activities']), ['Increasing Time on Task']);
  assert.deepEqual(subtractMasteredFromActive(null, ['x']), []);
  assert.deepEqual(subtractMasteredFromActive(undefined, ['x']), []);
});
