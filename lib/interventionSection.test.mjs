// Dedicated interventions pass — the PURE parts (locate / nameInDocument / merge). The LLM call itself is
// integration-measured, not unit-tested. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateInterventionSection, nameInDocument, mergeInterventions, MAX_INTERVENTION_SPAN } from './interventionSection.ts';

// ── locateInterventionSection ────────────────────────────────────────────────
test('locate: no distinctive heading → not matched (caller keeps whole-packet + menu)', () => {
  const loc = locateInterventionSection('A narrative with the word intervention used only in prose, nothing enumerated.');
  assert.equal(loc.matched, false);
  assert.equal(loc.oversized, false);
});

test('locate: single distinctive heading (Hendrex-like) → matched, span 0, fits', () => {
  const loc = locateInterventionSection('...blah... Hypothesis Based Interventions\nThe following ...names... ');
  assert.equal(loc.matched, true);
  assert.equal(loc.span, 0);
  assert.equal(loc.oversized, false);
  assert.match(loc.heading, /Hypothesis Based Interventions/i);
});

test('locate: first→last span within window → fits; beyond window → oversized (Felix-like)', () => {
  const near = 'Hypothesis Based Interventions ' + 'x'.repeat(5000) + ' Assigned Interventions:';
  assert.equal(locateInterventionSection(near).oversized, false, 'span 5K ≤ gate → fits');
  const far = 'Hypothesis Based Interventions ' + 'x'.repeat(MAX_INTERVENTION_SPAN + 5000) + ' Assigned Interventions:';
  assert.equal(locateInterventionSection(far).oversized, true, 'span > gate → oversized');
});

test('locate: /intervention procedures/ is NOT a trigger (excluded — wrong-hits Felix prose)', () => {
  const loc = locateInterventionSection('We will modify intervention procedures based on response patterns.');
  assert.equal(loc.matched, false);
});

test('locate: "PROCEDURES AND INTERVENTIONS TO REDUCE …" (Ximena) is a trigger', () => {
  const loc = locateInterventionSection('... PROCEDURES AND INTERVENTIONS TO REDUCE MALADAPTIVE BEHAVIORS ...');
  assert.equal(loc.matched, true);
});

// ── nameInDocument ───────────────────────────────────────────────────────────
const DOC = 'the therapist used token system and non contingent reinforcement and discrete trial training dtt with the client';
test('nameInDocument: descriptive core present (word-boundary)', () => {
  assert.equal(nameInDocument('Token System', DOC), true);
  assert.equal(nameInDocument('Discrete Trial Training', DOC), true);
});
test('nameInDocument: parenthetical acronym present as a token', () => {
  assert.equal(nameInDocument('Discrete Trial Training (DTT)', DOC), true);
});
test('nameInDocument: menu name NOT in the document → false', () => {
  assert.equal(nameInDocument('Guided Practice', DOC), false);
  assert.equal(nameInDocument('Systematic Prompting', DOC), false);
});

// ── mergeInterventions: union then source-presence filter ────────────────────
test('merge: dedicated names kept, main menu-inventions dropped, real main extras kept, deduped', () => {
  const doc = 'used token system, discrete trial training, and planned ignoring; also premack principle noted';
  const dedicated = ['Token System', 'Discrete Trial Training'];
  const main = ['Guided Practice' /* menu invention, not in doc → drop */, 'Planned Ignoring' /* real, out-of-window → keep */, 'token system' /* dup of dedicated → drop */, 'Premack Principle' /* real → keep */];
  const merged = mergeInterventions(main, dedicated, doc);
  assert.deepEqual(merged, ['Token System', 'Discrete Trial Training', 'Planned Ignoring', 'Premack Principle']);
  assert.equal(merged.includes('Guided Practice'), false, 'menu invention filtered out');
});

test('merge: empty dedicated (no section) still filters the main list to in-section names', () => {
  const section = 'planned ignoring and redirection were used';
  assert.deepEqual(mergeInterventions(['Planned Ignoring', 'Caregiver Training Procedures'], [], section), ['Planned Ignoring']);
});

test('merge is SECTION-scoped: a name present in the document but NOT in the section is dropped', () => {
  // The section (what mergeInterventions receives) mentions only Token System. "Task Analysis" appears
  // elsewhere in the wider document — but since it is NOT in the section, the scoped filter drops it, even
  // though a whole-document filter would have kept it. This is the fix + the deliberate recall trade.
  const section = 'the plan uses token system contingent on task completion';
  const merged = mergeInterventions(['Task Analysis' /* in the doc elsewhere, NOT in this section */], ['Token System'], section);
  assert.deepEqual(merged, ['Token System']);
  assert.equal(merged.includes('Task Analysis'), false, 'out-of-section name dropped by the section-scoped filter');
});

test('merge does NOT collapse near-duplicates: DRA and DRI both survive if both are in the section', () => {
  const section = 'differential reinforcement of alternative behaviors dra and differential reinforcement of incompatible behaviors dri';
  const merged = mergeInterventions([], ['Differential Reinforcement of Alternative Behaviors (DRA)', 'Differential Reinforcement of Incompatible Behaviors (DRI)'], section);
  assert.equal(merged.length, 2, 'DRA and DRI are distinct exact phrases — never merged into each other');
});
