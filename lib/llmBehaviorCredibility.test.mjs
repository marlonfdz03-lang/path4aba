// LLM behavior credibility + discontinued-authority reconciliation. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBehaviors, assessLlmBehaviorCredibility, looksLikeGarbageName, assessReplacementCompleteness } from './llmBehaviorCredibility.ts';

const b = (name, status = 'active', functions = ['escape']) => ({ name, status, functions, topographies: ['t'] });

test('credible: a clean active set passes', () => {
  const { active } = reconcileBehaviors([b('Tantrums'), b('Elopement', 'active', ['attention'])]);
  const r = assessLlmBehaviorCredibility(active, 3);
  assert.equal(r.credible, true, r.reasons.join('; '));
  assert.equal(r.reasons.length, 0);
});

test('UNREAD + empty LLM → not credible (preserve)', () => {
  const r = assessLlmBehaviorCredibility(reconcileBehaviors([]).active, 5);
  assert.equal(r.credible, false);
  assert.ok(r.reasons.some((x) => /empty active/.test(x)));
});

test('UNREAD + garbage names → not credible (preserve)', () => {
  const junk = reconcileBehaviors([
    b('Target Behaviors to Reduce'),                 // heading
    b('3.'),                                         // bare number
    b('The client engaged in a variety of behaviors throughout the session that were.'), // sentence
  ]).active;
  const r = assessLlmBehaviorCredibility(junk, 8);
  assert.equal(r.credible, false);
  assert.ok(r.reasons.some((x) => /garbage|non-behavior/.test(x)));
});

test('UNREAD + a behavior with no name → not credible', () => {
  const r = assessLlmBehaviorCredibility(reconcileBehaviors([b('Tantrums'), b('', 'active', ['escape'])]).active, 4);
  assert.equal(r.credible, false);
  assert.ok(r.reasons.some((x) => /no name/.test(x)));
});

test('duplicates are de-duped by normalization (not a rejection on their own)', () => {
  const { active } = reconcileBehaviors([b('Tantrums'), b('  tantrums! '), b('Elopement')]);
  assert.equal(active.length, 2, 'Tantrums de-duped');
  assert.equal(assessLlmBehaviorCredibility(active, 2).credible, true);
});

test('invalid function vocabulary → not credible', () => {
  const r = assessLlmBehaviorCredibility(reconcileBehaviors([b('Tantrums', 'active', ['boredom'])]).active, 2);
  assert.equal(r.credible, false);
  assert.ok(r.reasons.some((x) => /invalid function/.test(x)));
});

test('function-less set (no behavior carries a function) → not credible (partial parse)', () => {
  const r = assessLlmBehaviorCredibility(reconcileBehaviors([b('Tantrums', 'active', []), b('Elopement', 'active', [])]).active, 2);
  assert.equal(r.credible, false);
  assert.ok(r.reasons.some((x) => /no behavior in the set carries any function/.test(x)));
});

test('suspicious collapse (many previous → 1 new) → not credible', () => {
  const r = assessLlmBehaviorCredibility(reconcileBehaviors([b('Tantrums')]).active, 14);
  assert.equal(r.credible, false);
  assert.ok(r.reasons.some((x) => /collapse/.test(x)));
});

test('DISCONTINUED authority: a formal discontinued beats an incidental active mention of the same name', () => {
  const { active, droppedDiscontinued } = reconcileBehaviors([
    b('Climbing', 'discontinued', []),   // formal status block
    b('Climbing', 'active', ['escape']), // later incidental narrative mention
    b('Tantrums', 'active', ['attention']),
  ]);
  assert.ok(!active.some((x) => /climb/i.test(x.name)), 'Climbing must not be active');
  assert.ok(droppedDiscontinued.some((n) => /climb/i.test(n)));
  assert.deepEqual(active.map((x) => x.name), ['Tantrums']);
});

test('THE FELIX ACCEPTANCE TEST (reconciliation): exactly 13 active — no Climbing, no Lining up Objects, Isolation present', () => {
  // Fixture mirrors the documented-correct extraction: Climbing + Lining up Objects carry formal DISCONTINUED
  // declarations (and reappear as incidental active mentions in the "13 active" narrative list); Isolation is
  // the new 04/01/2026 target. 13 genuine active + the 2 discontinued (each also mentioned active) = 15 rows.
  const active13 = [
    'Arguing with Adults', 'Distractibility', 'Elopement', 'Fidgeting', 'Hand Flapping',
    'Impulsive Behavior', 'Interrupting Others', 'Non-Compliance', 'Physical Aggression',
    'Tantrums', 'Throwing Objects', 'Verbal Aggression', 'Isolation',
  ];
  const llm = [
    ...active13.map((n) => b(n, 'active', ['escape'])),
    b('Climbing', 'discontinued', []),
    b('Climbing', 'active', ['escape']),                 // incidental re-list in "13 active"
    b('Lining up Objects', 'discontinued', []),
    b('Lining up Objects', 'active', ['automatic']),     // incidental re-list
  ];
  const { active } = reconcileBehaviors(llm);
  const names = active.map((x) => x.name);
  assert.equal(active.length, 13, `expected 13 active, got ${active.length}: ${names.join(', ')}`);
  assert.ok(!names.some((n) => /climb/i.test(n)), 'no Climbing');
  assert.ok(!names.some((n) => /lining up/i.test(n)), 'no Lining up Objects');
  assert.ok(names.includes('Isolation'), 'Isolation present');
  assert.equal(assessLlmBehaviorCredibility(active, 14).credible, true, 'the 13-active set is credible');
});

test('replacement completeness guard', () => {
  // Felix's exact failure: domain found, 18 → 9 → suspicious → preserve
  assert.equal(assessReplacementCompleteness(9, 18, true).refresh, false);
  assert.match(assessReplacementCompleteness(9, 18, true).reason, /large unexplained drop/);
  // domain not in packet → preserve
  assert.equal(assessReplacementCompleteness(12, 12, false).refresh, false);
  // empty extraction → preserve
  assert.equal(assessReplacementCompleteness(0, 5, true).refresh, false);
  // legitimate refresh (full catalog, or a modest change) → refresh
  assert.equal(assessReplacementCompleteness(17, 18, true).refresh, true);
  assert.equal(assessReplacementCompleteness(13, 18, true).refresh, true); // >=60% kept
  // a brand-new client (no previous) → refresh
  assert.equal(assessReplacementCompleteness(4, 0, true).refresh, true);
});

test('looksLikeGarbageName basics', () => {
  for (const g of ['', '   ', '4', '4.', 'Section 2: Target Behaviors', 'Behaviors to Reduce']) assert.equal(looksLikeGarbageName(g), true, `garbage: ${g}`);
  for (const ok of ['Tantrums', 'Self-Injurious Behavior (SIB)', 'Lining up Objects', 'Physical Aggression']) assert.equal(looksLikeGarbageName(ok), false, `ok: ${ok}`);
});
