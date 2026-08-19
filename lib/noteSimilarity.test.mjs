// Note-uniqueness (Bug 6, Option C). Run: `npm test`.
//
// The contract: a too-similar note WARNS but NEVER regenerates (uniqueness is cosmetic — it must not burn
// an LLM call). The four COMPLIANCE gates are a different category and still regenerate on defective notes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSimilarity, decideUniqueness, SIMILARITY_WARN_THRESHOLD } from './noteSimilarity.ts';
import { findMissingFunctionABCs } from './functionPatterns.ts';

test('threshold is the provisional operational 0.80', () => {
  assert.equal(SIMILARITY_WARN_THRESHOLD, 0.80);
});

test('MARLON REQUIRED: similarity > threshold → warns, and regeneration count is ZERO', () => {
  // Two near-identical notes (Jaccard > 0.80).
  const note = 'the client began banging the table consistent with the documented attention function and the RBT redirected';
  const prior = 'the client began banging the table consistent with the documented attention function and the RBT prompted';
  assert.ok(calculateSimilarity(note, prior) > SIMILARITY_WARN_THRESHOLD, 'these are above threshold');

  const decision = decideUniqueness(note, [prior]);
  assert.equal(decision.warn, true, 'similarityWarning === true');
  assert.equal(decision.regenerate, false, 'uniqueness NEVER triggers a regeneration (count === 0)');
});

test('below threshold → no warning (and still never regenerates)', () => {
  const a = 'alpha beta gamma delta epsilon zeta eta xxx';
  const b = 'alpha beta gamma delta epsilon zeta eta yyy';
  const sim = calculateSimilarity(a, b); // 7 shared / 9 union ≈ 0.78
  assert.ok(sim > 0.60 && sim < 0.80, `sim ${sim} sits between the OLD 0.60 and the NEW 0.80`);
  const decision = decideUniqueness(a, [b]);
  assert.equal(decision.warn, false, 'raised threshold: a 0.60-era warning no longer fires');
  assert.equal(decision.regenerate, false);
});

test('no note history → no warning, no regeneration', () => {
  const decision = decideUniqueness('any note text', []);
  assert.equal(decision.warn, false);
  assert.equal(decision.regenerate, false);
});

test('regenerate is ALWAYS false — even for an identical note (the Option C invariant)', () => {
  const identical = 'exactly the same clinical note text repeated verbatim across sessions';
  assert.equal(calculateSimilarity(identical, identical), 1);
  const decision = decideUniqueness(identical, [identical]);
  assert.equal(decision.warn, true, 'an identical note still WARNS');
  assert.equal(decision.regenerate, false, 'but it NEVER regenerates');
});

test('MARLON REQUIRED: compliance gates still fire independently (compliance ≠ cosmetic)', () => {
  // A clinically-defective note (ABC 2 lacks its documented function) still triggers the COVERAGE
  // compliance gate — which regenerates — even though the uniqueness path would only warn.
  const behaviors = [
    { name: 'Disruptive Behavior', topography: 'banging the table' },
    { name: 'Off-Task Behavior', topography: 'looking around the room' },
  ];
  const skills = ['Manding for Attention Response'];
  const defectiveNote =
    'During group work the client began banging the table, consistent with the documented attention function; the RBT redirected. ' +
    'As the worksheet began the client kept looking around the room; the RBT prompted and the client re-engaged. ' +
    'In addition to behavior-reduction programming, skill acquisition targeted Manding for Attention Response with verbal prompting.';

  const coverage = findMissingFunctionABCs(defectiveNote, behaviors, skills);
  assert.equal(coverage.segmentable, true);
  assert.deepEqual(coverage.missing.map((m) => m.name), ['Off-Task Behavior'],
    'the coverage compliance gate flags the ABC missing its function → it WOULD regenerate');

  // The very same note, on the uniqueness path, never regenerates — proving the two categories are separate.
  assert.equal(decideUniqueness(defectiveNote, [defectiveNote]).regenerate, false);
});
