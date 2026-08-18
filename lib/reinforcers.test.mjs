// Reinforcer parsing (Bug 2). Run: `npm test`. The July assessments return reinforcers as PROSE, which a
// naive comma-split shredded into garbage ("Preferred food items such as strawberries", "and pizza",
// "'Nice work"). These lock in the clean parse + the array passthrough.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReinforcers, splitReinforcerValue } from './reinforcers.ts';

// Same shred-detection the harness uses — every output item must be clean.
function shredded(item) {
  const s = String(item);
  return /^\s*(and|or|like|such as|including|e\.g\.)\b/i.test(s)
    || /\bsuch as\b/i.test(s)
    || ((s.match(/'/g) || []).length % 2) === 1
    || ((s.match(/"/g) || []).length % 2) === 1
    || /^[\s'"().,;:-]+$/.test(s);
}

test('array passthrough: discrete items kept as-is (the new prompt shape)', () => {
  assert.deepEqual(parseReinforcers({ tangibles: ['Strawberries', 'Tablet'], social: ['verbal praise'] }),
    ['Strawberries', 'Tablet', 'verbal praise']);
});

test('prose string: "X such as a, b, and c" -> [a, b, c], no prefix, no leading "and"', () => {
  const items = splitReinforcerValue('Preferred food items such as strawberries, cookies, and pizza');
  assert.deepEqual(items, ['strawberries', 'cookies', 'pizza']);
});

test('the real Alexandra shred cases all come out clean', () => {
  const reinforcers = {
    tangibles: "Preferred food items such as strawberries, cookies, chocolate, and pizza, and limited access to electronic devices such as a tablet or phone",
    social: "Behavior-specific verbal praise such as 'Great job,' 'Nice work,' or 'Excellent,' positive facial expressions, clapping, and social acknowledgment",
    people: "Mother",
    activities: "",
  };
  const items = parseReinforcers(reinforcers);
  const bad = items.filter(shredded);
  assert.deepEqual(bad, [], `no shredded fragments; got bad=${JSON.stringify(bad)} full=${JSON.stringify(items)}`);
  // spot-check some expected clean items survive
  for (const expected of ['strawberries', 'cookies', 'chocolate', 'pizza', 'Great job', 'Nice work', 'Excellent', 'clapping', 'social acknowledgment', 'Mother']) {
    assert.ok(items.some((i) => i.toLowerCase() === expected.toLowerCase()), `expected "${expected}" in ${JSON.stringify(items)}`);
  }
});

test('Brandon-style prose ("including X, and Y") is clean too', () => {
  const items = parseReinforcers({
    tangibles: 'electronic devices such as a tablet or phone, and rotating or novel items to maintain motivation',
    activities: 'participating in outdoor activities such as park or playground time, and recreational outings including walks or beach visits',
  });
  assert.deepEqual(items.filter(shredded), []);
});

test('ARRAY items are cleaned too (a prose item inside an array must not slip through)', () => {
  const items = parseReinforcers({
    activities: ['swimming', 'brief community outings such as mall walks', 'water play'],
    social: ["'Great job'", 'and clapping'],
  });
  assert.deepEqual(items.filter(shredded), [], JSON.stringify(items));
  assert.ok(items.includes('mall walks'));
  assert.ok(items.includes('swimming'));
  assert.ok(items.includes('clapping'));
});

test('" or " alternatives split into discrete items; " and " compounds stay whole', () => {
  // The #4 fix: "tablet or phone" is an unresolved alternative — split so the note names ONE.
  assert.deepEqual(splitReinforcerValue('tablet or phone'), ['tablet', 'phone']);
  // CRITICAL CAVEAT: " and " must NOT split — it joins legitimate compound items.
  assert.deepEqual(splitReinforcerValue('arts and crafts'), ['arts and crafts']);
  assert.deepEqual(splitReinforcerValue('kinetic sand and bin'), ['kinetic sand and bin']);
  // Existing comma split still works alongside the new " or " split.
  assert.deepEqual(splitReinforcerValue('tablet, phone'), ['tablet', 'phone']);
  // No delimiter at all -> single item unchanged.
  assert.deepEqual(splitReinforcerValue('sensory bin'), ['sensory bin']);
  // "or" inside a word is NOT a delimiter (whitespace-bounded token only).
  assert.deepEqual(splitReinforcerValue('coloring'), ['coloring']);
  // Comma + " or " combined: both delimiters resolve.
  assert.deepEqual(splitReinforcerValue('tablet or phone, kinetic sand'), ['tablet', 'phone', 'kinetic sand']);
});

test('dedupe (case-insensitive) + drop empties/stopwords', () => {
  assert.deepEqual(parseReinforcers({ tangibles: 'Tablet, tablet, , and', social: 'Tablet' }), ['Tablet']);
});

test('empty / missing categories -> []', () => {
  assert.deepEqual(parseReinforcers({}), []);
  assert.deepEqual(parseReinforcers({ tangibles: '', social: [] }), []);
});
