// assembleRefreshProfile — the reworked UNREAD branch (credible LLM → llm-fallback; else preserve). Run: `npm test`.
// rows=[] forces geometry UNREAD (readBehaviorFunctions([])===0), which is exactly the prose-woven case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleRefreshProfile } from './assembleRefreshProfile.ts';

const beh = (name, status = 'active', functions = ['escape']) => ({ name, status, functions, topographies: ['t'] });
const existing = { maladaptiveBehaviors: [beh('Old Behavior A'), beh('Old Behavior B')], masteredBehaviors: [] };
const bFlag = (r) => r.reviewFlags.find((f) => f.field === 'behaviors');

test('UNREAD + CREDIBLE llm behaviors → use NEW behaviors, source llm-fallback', () => {
  const llm = { maladaptiveBehaviors: [beh('Tantrums'), beh('Elopement', 'active', ['attention'])], masteredBehaviors: [] };
  const r = assembleRefreshProfile(llm, [], existing);
  assert.equal(r.confidence.level, 'UNREAD');
  assert.deepEqual(r.profile.maladaptiveBehaviors.map((b) => b.name), ['Tantrums', 'Elopement']);
  assert.equal(bFlag(r).source, 'llm-fallback');
  assert.match(bFlag(r).reason, /AI fallback/i);
});

test('UNREAD + NOT credible (garbage) → PRESERVE previous, source guard-preserved', () => {
  const llm = { maladaptiveBehaviors: [beh('Target Behaviors to Reduce'), beh('3.')], masteredBehaviors: [] };
  const r = assembleRefreshProfile(llm, [], existing);
  assert.deepEqual(r.profile.maladaptiveBehaviors.map((b) => b.name), ['Old Behavior A', 'Old Behavior B']);
  assert.equal(bFlag(r).source, 'guard-preserved');
});

test('UNREAD + empty llm → PRESERVE previous', () => {
  const r = assembleRefreshProfile({ maladaptiveBehaviors: [], masteredBehaviors: [] }, [], existing);
  assert.deepEqual(r.profile.maladaptiveBehaviors.map((b) => b.name), ['Old Behavior A', 'Old Behavior B']);
  assert.equal(bFlag(r).source, 'guard-preserved');
});

test('UNREAD + credible with a DISCONTINUED that also appears active → discontinued dropped', () => {
  const llm = { maladaptiveBehaviors: [
    beh('Climbing', 'discontinued', []), beh('Climbing', 'active', ['escape']),
    beh('Tantrums'), beh('Isolation', 'active', ['attention']),
  ], masteredBehaviors: [] };
  const r = assembleRefreshProfile(llm, [], existing);
  const names = r.profile.maladaptiveBehaviors.map((b) => b.name);
  assert.ok(!names.some((n) => /climb/i.test(n)), 'Climbing (discontinued) excluded');
  assert.deepEqual(names, ['Tantrums', 'Isolation']);
  assert.equal(bFlag(r).source, 'llm-fallback');
});

test('create path (no existing) + not credible → still applies flagged AI behaviors (beats empty)', () => {
  const llm = { maladaptiveBehaviors: [beh('Tantrums', 'active', [])], masteredBehaviors: [] }; // function-less → not credible
  const r = assembleRefreshProfile(llm, [], undefined);
  assert.deepEqual(r.profile.maladaptiveBehaviors.map((b) => b.name), ['Tantrums']);
  assert.equal(bFlag(r).source, 'llm-fallback');
});
