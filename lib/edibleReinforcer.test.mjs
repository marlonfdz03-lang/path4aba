// Advisory edible check (warn, never block). Run: `npm test`.
// Conservative: must catch clear edibles but NEVER false-warn on common non-edible reinforcers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksEdible } from './edibleReinforcer.ts';

test('flags clear edibles', () => {
  for (const s of [
    'goldfish crackers', 'cookies', 'fruit snacks', 'juice box', 'candy', 'chocolate chips',
    'strawberries', 'grapes', 'pretzels', 'popcorn', 'M&Ms', 'skittles', 'a preferred snack',
    'favorite food', 'gummy bears', 'ice cream', 'cheese', 'apple juice',
  ]) {
    assert.equal(looksEdible(s), true, `should flag: ${s}`);
  }
});

test('does NOT false-warn on common non-edible reinforcers', () => {
  for (const s of [
    'fidget toy', 'tablet', 'iPad', 'sensory bin', 'bubbles', 'monkey bars', 'stickers',
    'trampoline', 'kinetic sand', 'play-doh', 'movement break', 'preferred toy', 'toy car',
    'Pokémon cards', 'music access', 'drawing materials', 'spinning top', 'poker chip', 'high five',
  ]) {
    assert.equal(looksEdible(s), false, `should NOT flag: ${s}`);
  }
});

test('empty / non-string is not edible', () => {
  assert.equal(looksEdible(''), false);
  assert.equal(looksEdible(null), false);
  assert.equal(looksEdible(undefined), false);
});

test('word-boundary: "fruit" flags but a substring inside another word does not', () => {
  assert.equal(looksEdible('dried fruit'), true);
  assert.equal(looksEdible('fruitful praise'), false); // \bfruit\b does not match "fruitful"
});

// ── strengthened denylist (after the live "French fries" miss) ────────────────────────────────
test('MARLON REQUIRED: the client array that reached production is 8/8 caught', () => {
  for (const s of ['strawberries', 'cookies', 'chocolate', 'ice cream', 'candy', 'French fries', 'chicken nuggets', 'pizza'])
    assert.equal(looksEdible(s), true, `should flag: ${s}`);
});

test('the new savory / sweet / branded edibles are caught', () => {
  for (const s of ['fries', 'french fries', 'chicken nuggets', 'hot dog', 'hamburger', 'taco', 'nachos',
    'cupcake', 'brownie', 'donut', 'popsicle', 'waffle', 'Doritos', 'Takis', 'peanut butter', 'fruit cup',
    'cheese sticks', 'potato chips'])
    assert.equal(looksEdible(s), true, `should flag: ${s}`);
});

test('REGRESSION: the three collision cases must NEVER be flagged (do not re-add bare keywords)', () => {
  // bare "chip"/"chips" would break these:
  assert.equal(looksEdible('poker chip'), false);
  assert.equal(looksEdible('poker chips'), false);
  // bare "egg"/"eggs" would break these:
  assert.equal(looksEdible('egg shaker'), false);
  assert.equal(looksEdible('plastic eggs'), false);
  // bare "chicken" would break this:
  assert.equal(looksEdible('chicken dance song'), false);
});

test('"food" is kept despite over-catching pretend-food toys (safe direction, per Marlon)', () => {
  assert.equal(looksEdible('preferred food'), true);
  assert.equal(looksEdible('favorite food'), true);
  assert.equal(looksEdible('play kitchen food'), true); // acceptable over-catch — note simply omits it
});
