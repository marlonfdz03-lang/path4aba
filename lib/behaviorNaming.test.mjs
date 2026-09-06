// BEHAVIOR NAMING (verbatim, measurement-only). Run: `npm test`.
// Locks: verbatim substring match (case-insensitive); parenthetical-alias forms all count as the plan's
// own words; a paraphrase reads as NOT named (the known, documented limitation); nothing recorded when
// there are no behaviors; the finding is admin-only info and carries names, never note text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { behaviorNamingFindings, verbatimForms } from './behaviorNaming.ts';

test('verbatim present (case-insensitive) is named; absent is not', () => {
  const note = 'When a demand was placed, the client engaged in tantrum behavior; later he began climbing furniture.';
  const f = behaviorNamingFindings(note, ['Tantrum', 'Climbing', 'Mouthing']);
  assert.equal(f.length, 1);
  assert.equal(f[0].gate, 'behavior_naming');
  assert.equal(f[0].severity, 'info');
  assert.deepEqual(f[0].context.named.sort(), ['Climbing', 'Tantrum']);
  assert.deepEqual(f[0].context.notNamed, ['Mouthing']);
  assert.equal(f[0].context.namedCount, 2);
  assert.equal(f[0].context.total, 3);
});

test('parenthetical alias: full name, base, or alias all count as verbatim', () => {
  assert.deepEqual(verbatimForms('Self-Injurious Behavior (SIB)'), ['Self-Injurious Behavior (SIB)', 'Self-Injurious Behavior', 'SIB']);
  // note uses the alias only
  const a = behaviorNamingFindings('The RBT blocked instances of SIB.', ['Self-Injurious Behavior (SIB)']);
  assert.deepEqual(a[0].context.named, ['Self-Injurious Behavior (SIB)']);
  // note uses the base name only
  const b = behaviorNamingFindings('self-injurious behavior was observed', ['Self-Injurious Behavior (SIB)']);
  assert.deepEqual(b[0].context.named, ['Self-Injurious Behavior (SIB)']);
  // note uses neither -> not named
  const c = behaviorNamingFindings('the client hit his own head', ['Self-Injurious Behavior (SIB)']);
  assert.deepEqual(c[0].context.notNamed, ['Self-Injurious Behavior (SIB)']);
});

test('a paraphrase reads as NOT named — the documented limitation, on purpose', () => {
  // "Ear Covering" documented only by topography must count as not-named: this is verbatim, not semantic.
  const f = behaviorNamingFindings('the client covered his ears with both hands', ['Ear Covering']);
  assert.deepEqual(f[0].context.notNamed, ['Ear Covering']);
  assert.equal(f[0].context.namedCount, 0);
});

test('no behaviors -> records nothing', () => {
  assert.deepEqual(behaviorNamingFindings('anything', []), []);
  assert.deepEqual(behaviorNamingFindings('anything', null), []);
});

test('the finding carries names only, never the note text (PHI-safe by construction)', () => {
  const note = 'When [client] climbed the shelf, the RBT redirected him.';
  const f = behaviorNamingFindings(note, ['Climbing']);
  assert.ok(!JSON.stringify(f).includes('[client]'));
  assert.ok(!JSON.stringify(f).includes('redirected'));
});
