// FUNCTION TAG (measurement-only, post-gate self-read). Run: `npm test`.
// Locks: a disagreement is recorded with BOTH values; an unparseable/absent reply records
// function_tag_unavailable and NEVER throws; the record is self-contained (assigned + read per behavior).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionTagFindings, parseFunctionReadJson } from './functionTag.ts';

const perBehavior = {
  Climbing: { function: 'escape' },
  Elopement: { function: 'attention' },
};

test('a disagreement is recorded with BOTH values (assigned + read), self-contained', () => {
  const f = functionTagFindings(perBehavior, '{"Climbing":"attention","Elopement":"attention"}');
  assert.equal(f.length, 1);
  assert.equal(f[0].gate, 'function_tag');
  assert.equal(f[0].severity, 'info');
  const rows = f[0].context.rows;
  const climb = rows.find((r) => r.behavior === 'Climbing');
  assert.deepEqual(climb, { behavior: 'Climbing', assigned: 'escape', read: 'attention', agree: false });
  const elope = rows.find((r) => r.behavior === 'Elopement');
  assert.equal(elope.agree, true);
  assert.equal(f[0].context.disagreements, 1);
});

test('full agreement → zero disagreements', () => {
  const f = functionTagFindings(perBehavior, '{"Climbing":"escape","Elopement":"attention"}');
  assert.equal(f[0].gate, 'function_tag');
  assert.equal(f[0].context.disagreements, 0);
  assert.ok(f[0].context.rows.every((r) => r.agree));
});

test('case-insensitive behavior-name match + prose synonyms map via functionToCanonical', () => {
  const f = functionTagFindings({ Climbing: { function: 'escape' } }, '{"climbing":"Avoidance"}'); // avoidance→escape
  assert.equal(f[0].context.rows[0].read, 'escape');
  assert.equal(f[0].context.rows[0].agree, true);
});

test('unparseable reply → function_tag_unavailable, no throw', () => {
  for (const bad of [null, undefined, '', 'not json at all', '{oops', '[]']) {
    const f = functionTagFindings(perBehavior, bad);
    assert.equal(f.length, 1, `bad=${JSON.stringify(bad)}`);
    assert.equal(f[0].gate, 'function_tag_unavailable');
  }
});

test('no behavior has an assigned function → records nothing', () => {
  assert.deepEqual(functionTagFindings({ Climbing: { function: '' }, X: {} }, '{"Climbing":"escape"}'), []);
  assert.deepEqual(functionTagFindings(null, '{"Climbing":"escape"}'), []);
});

test('parseFunctionReadJson extracts an embedded object and rejects non-objects', () => {
  assert.deepEqual(parseFunctionReadJson('here you go: {"A":"escape"} thanks'), { A: 'escape' });
  assert.equal(parseFunctionReadJson('[1,2,3]'), null);
  assert.equal(parseFunctionReadJson(''), null);
});

// The pure function takes ONLY perBehavior + the raw reply — it is never handed the note object and cannot
// mutate it, which is why the returned note is byte-identical whether this measurement succeeds or fails.
test('functionTagFindings never receives or returns the note (byte-identity guarantee is structural)', () => {
  const f = functionTagFindings(perBehavior, '{"Climbing":"escape","Elopement":"attention"}');
  assert.ok(!JSON.stringify(f).includes('NOTE'));
});
