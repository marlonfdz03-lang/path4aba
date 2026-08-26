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

test('"academic" (2nd confirmed ABA-Matrix rejection) is substituted, never left to reach the EHR', () => {
  const r = filterBlockedNarrative('when a non-preferred academic demand was introduced, the RBT paused before re-presenting the academic demand');
  assert.ok(!/academic/i.test(r.text), 'no "academic" survives into the returned note');
  assert.match(r.text, /non-preferred structured demand/);
  assert.deepEqual(r.flagged, []); // has a substitute → auto-fixed, not merely flagged
  assert.ok(r.substituted.includes('academic'));
  // capitalization preserved
  assert.match(filterBlockedNarrative('Academic tasks were presented.').text, /^Structured tasks/);
});

test('"calm"/"calmed" (mentalistic + EHR-rejected) are substituted with observable words', () => {
  assert.match(filterBlockedNarrative('the client was calm for the rest of the session').text, /was quiet/);
  assert.match(filterBlockedNarrative('the client calmed down after the transition').text, /quieted down/);
  assert.ok(!/calm/i.test(filterBlockedNarrative('the client was calm and then calmed down').text));
});

test('PLAN-CONTENT PROTECTION: a blocked term inside an authorized name is left untouched', () => {
  const authorized = ['Calm-Down Routine', 'sensory bin'];
  // "Calm-Down Routine" is a plan program name → survives; the model's own "was calm" → substituted.
  const r = filterBlockedNarrative('The RBT implemented the Calm-Down Routine; the client was calm afterward.', [], authorized);
  assert.match(r.text, /Calm-Down Routine/, 'authorized program name preserved');
  assert.match(r.text, /was quiet afterward/, "the model's own mentalistic prose is substituted");
  // "sensory bin" reinforcer name survives; a stray "sensory input" prose is substituted.
  const r2 = filterBlockedNarrative('accessed the (sensory bin) after sensory input', [], authorized);
  assert.match(r2.text, /\(sensory bin\)/, 'authorized reinforcer name preserved');
  assert.match(r2.text, /tactile input/);
});

test('parses the host "text < X > is not allowed" message', () => {
  assert.equal(parseBlockedTermMessage('The text < academic > is not allowed in the narrative section'), 'academic');
  assert.equal(parseBlockedTermMessage('The text < sensory > is not allowed in the narrative section'), 'sensory');
  assert.equal(parseBlockedTermMessage('The text < weighted vest > is not allowed in the narrative section'), 'weighted vest');
  assert.equal(parseBlockedTermMessage('Some unrelated validation error'), null);
});
