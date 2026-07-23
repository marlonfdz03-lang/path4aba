// Regression guard for the blocked-narrative filter (see blockedNarrativeTerms.ts).
// Run with: `npm test` (Node's built-in runner; no deps).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterBlockedNarrative, parseBlockedTermMessage } from './blockedNarrativeTerms.ts';

test('substitutes "sensory" and never emits it in the output', () => {
  const r = filterBlockedNarrative('During a (sensory play activity) the client engaged; a Sensory bin was offered.');
  assert.ok(!/\bsensory\b/i.test(r.text), `output still contains "sensory": ${r.text}`);
  assert.match(r.text, /\(tactile play activity\)/);
  assert.match(r.text, /Tactile bin/); // leading-case preserved
  assert.deepEqual(r.substituted, ['sensory']);
  assert.deepEqual(r.flagged, []);
});

test('text with no blocked terms is unchanged', () => {
  const input = 'During a (puzzle activity) the client engaged appropriately.';
  const r = filterBlockedNarrative(input);
  assert.equal(r.text, input);
  assert.deepEqual(r.substituted, []);
  assert.deepEqual(r.flagged, []);
});

test('a blocked term with no substitute is flagged, never deleted', () => {
  const r = filterBlockedNarrative('The client used a weighted vest during the task.', [{ term: 'weighted vest', substitute: null }]);
  assert.match(r.text, /weighted vest/); // left in place
  assert.deepEqual(r.flagged, ['weighted vest']);
});

test('parses the host "text < X > is not allowed" message', () => {
  assert.equal(parseBlockedTermMessage('The text < sensory > is not allowed in the narrative section'), 'sensory');
  assert.equal(parseBlockedTermMessage('The text < weighted vest > is not allowed in the narrative section'), 'weighted vest');
  assert.equal(parseBlockedTermMessage('Some unrelated validation error'), null);
});
