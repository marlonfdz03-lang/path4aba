// Locks the human-facing "Needs review" banner copy (see reviewFlagCopy.ts). Run: `npm test`
// (Node's built-in runner; no deps).
//
// The rule: the banner maps each guard flag to plain-language, actionable copy keyed on field+source,
// and NEVER surfaces the raw engineer `reason` (geometry/LLM/confidence jargon). These are the exact
// four shapes lib/assembleRefreshProfile.ts emits, plus the per-behavior shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagCopy, reviewBannerLines } from './reviewFlagCopy.ts';

test('guard-preserved · behaviors → "kept from the previous assessment"', () => {
  const line = flagCopy({ field: 'behaviors', source: 'guard-preserved', reason: 'read confidence LOW (geometry ...)' });
  assert.equal(
    line,
    "Behaviors were kept from the previous assessment because this upload couldn't be read clearly. Please review the behavior list to confirm it's current."
  );
  assert.ok(!/geometry|LLM|confidence/i.test(line), 'must not leak raw jargon reason');
});

test('llm-fallback · diagnosis → "read from the report text"', () => {
  assert.equal(
    flagCopy({ field: 'diagnosis', source: 'llm-fallback', reason: 'diagnosis read from LLM text ...' }),
    'The diagnosis was read from the report text, not a structured table. Please verify the diagnosis is correct.'
  );
});

test('llm-fallback · skillAcquisition → "Mastered skills ... read from the report text"', () => {
  assert.equal(
    flagCopy({ field: 'skillAcquisition', source: 'llm-fallback', reason: 'mastered skills read from LLM ...' }),
    'Mastered skills were read from the report text, not a structured list. Please verify the skills are correct.'
  );
});

test('llm-fallback · behaviors (create path) → "Behaviors were read from the report text"', () => {
  assert.equal(
    flagCopy({ field: 'behaviors', source: 'llm-fallback', reason: 'read confidence UNREAD ... behaviors from LLM' }),
    'Behaviors were read from the report text, not a structured table. Please verify the behavior list is correct.'
  );
});

test('behavior-review · behavior:<name> → strips prefix, shows the name', () => {
  assert.equal(
    flagCopy({ field: 'behavior:Elopement', source: 'behavior-review', reason: 'unresolved name — not structurally verified' }),
    'One behavior may not have been read correctly — please verify: Elopement.'
  );
  // multi-word name preserved, prefix + surrounding space trimmed
  assert.equal(
    flagCopy({ field: 'behavior: Property Destruction ', source: 'behavior-review' }),
    'One behavior may not have been read correctly — please verify: Property Destruction.'
  );
});

test('unknown field → defensive, still actionable, no jargon', () => {
  const line = flagCopy({ field: 'somethingNew', source: 'llm-fallback' });
  assert.match(line, /needs review — please verify/);
});

test('reviewBannerLines dedupes identical lines and preserves order', () => {
  const lines = reviewBannerLines([
    { field: 'diagnosis', source: 'llm-fallback' },
    { field: 'behavior:Elopement', source: 'behavior-review' },
    { field: 'diagnosis', source: 'llm-fallback' }, // duplicate line
    { field: 'behavior:Aggression', source: 'behavior-review' },
  ]);
  assert.deepEqual(lines, [
    'The diagnosis was read from the report text, not a structured table. Please verify the diagnosis is correct.',
    'One behavior may not have been read correctly — please verify: Elopement.',
    'One behavior may not have been read correctly — please verify: Aggression.',
  ]);
});

test('reviewBannerLines handles missing/empty/non-array safely', () => {
  assert.deepEqual(reviewBannerLines(undefined), []);
  assert.deepEqual(reviewBannerLines(null), []);
  assert.deepEqual(reviewBannerLines([]), []);
});
