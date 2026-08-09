// Locks readTargetList — the "Behavior(s) to Reduce" capsule reader used to detect a named-but-undefined
// target behavior (see assembleRefreshProfile / the target-undefined flag). Run: `npm test`.
//
// Keys on the target-list HEADER vocabulary + the left-column list, bounded by the next major section — no
// client/behavior name. Rows are the geometry shape { page, y, cells: [{ text, x, y, page }] }.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTargetList } from './pdfGeometry.ts';

// helper: build a Row from [text, x] pairs on one line
const row = (page, y, ...cells) => ({ page, y, cells: cells.map(([text, x]) => ({ text, x, y, page })) });

test('reads the capsule names, first inline after the header, bounded by the next section', () => {
  const rows = [
    row(1, 9.1, ['Behavior to Reduce: Tantrums', 3]),
    row(1, 9.8, ['Hyperactivity', 3]),
    row(1, 10.5, ['Self-Injurious Behavior (SIB)', 3]),
    row(1, 11.3, ['Non-Compliance with Hygiene Routines', 3]),
    row(1, 12.0, ['Behaviors to increase: Skill Acquisition Goals', 3]), // boundary — list ends
    row(1, 12.8, ['Manding for help', 3]), // after boundary → excluded
  ];
  assert.deepEqual(readTargetList(rows), [
    'Tantrums', 'Hyperactivity', 'Self-Injurious Behavior (SIB)', 'Non-Compliance with Hygiene Routines',
  ]);
});

test('no target capsule present → [] (no flags will be produced)', () => {
  const rows = [
    row(1, 9, ['Client Overview', 3]),
    row(1, 10, ['Some narrative text about the client.', 3]),
  ];
  assert.deepEqual(readTargetList(rows), []);
});

test('alternate header vocabulary ("Target Behaviors") is recognized', () => {
  const rows = [
    row(1, 5, ['Target Behaviors', 3]),
    row(1, 6, ['Elopement', 3]),
    row(1, 7, ['Aggression', 3]),
    row(1, 8, ['Replacement Programs', 3]), // boundary
  ];
  assert.deepEqual(readTargetList(rows), ['Elopement', 'Aggression']);
});

test('bullet list and a large vertical gap both end the capsule', () => {
  const rows = [
    row(1, 5, ['Behaviors to Decrease', 3]),
    row(1, 6, ['Tantrums', 3]),
    row(1, 9.5, ['Food Refusal', 3]), // gap > 2 from prior → list already ended at the gap
  ];
  assert.deepEqual(readTargetList(rows), ['Tantrums']);
});
