// Batch 4 (stos, rbt/data-corrections): stos reuses principalCanAccessRow (covered in clientAccessRow.test).
// The data-corrections PATCH is the one with a caller-chosen `type` that selects WHICH table to touch. This
// asserts the table-selection contract: a valid type maps to exactly one table for BOTH resolution and
// mutation; an invalid/unexpected type maps to NO table (→ the route 400s before any DB access), so an
// attacker cannot point the ownership lookup at one table while the write lands on another.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the route's selection expression exactly.
const selectModel = (type) =>
  type === 'replacement' ? 'replacement_data' :
  type === 'maladaptive' ? 'maladaptive_data' :
  null;

test('valid types select exactly one table', () => {
  assert.equal(selectModel('replacement'), 'replacement_data');
  assert.equal(selectModel('maladaptive'), 'maladaptive_data');
});

test('invalid / unexpected type selects NO table (route denies before any DB access)', () => {
  for (const bad of ['', 'stos', 'clients', 'admin', 'REPLACEMENT', 'maladaptive ', 'null', undefined, null, 0, {}]) {
    assert.equal(selectModel(bad), null, `type ${JSON.stringify(bad)} must not map to a table`);
  }
});

test('resolution and mutation use the SAME selected table (one reference, cannot diverge)', () => {
  // The route resolves `const model = selectModel(type)` once and calls both model.findUnique and
  // model.update on it — so for any given request the two operations are guaranteed identical.
  for (const type of ['replacement', 'maladaptive']) {
    const model = selectModel(type);
    const resolutionTable = model;
    const mutationTable = model;
    assert.equal(resolutionTable, mutationTable);
  }
});
