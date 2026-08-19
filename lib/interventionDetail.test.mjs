// Regression for the conditional per-intervention prompt detail (see interventionDetail.ts).
// Run with: `npm test` (Node's built-in runner; no deps).
//
// The bug this locks out: the master prompt taught Behavior Momentum (and DRA, Token Economy, …) to
// EVERY client, including clients whose plan approves none of them. The model followed the specific
// instruction over the general closed-set rule, the compliance gate correctly rejected the note, and
// the RBT got a hard block on an intervention the system itself had advertised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInterventionDetail, INTERVENTION_DETAIL } from './interventionDetail.ts';
import { MASTER_RBT_NOTE_PROMPT } from '../app/prompts/masterPrompt.ts';
import { NOTE_PERFECTOR_PROMPT } from '../app/prompts/notePerfectorPrompt.ts';

test('a plan approving only DRA and FCT is never taught any other intervention', () => {
  const detail = buildInterventionDetail(['DRA', 'FCT']);
  assert.match(detail, /DRA DEFINITION/, 'DRA is approved, so its detail is present');
  assert.match(detail, /FCT DOCUMENTATION/, 'FCT is approved, so its detail is present');
  for (const absent of ['Behavior Momentum', 'Token Economy', 'Premack', 'Noncontingent']) {
    assert.ok(!detail.includes(absent), `"${absent}" must not be taught to a DRA+FCT client`);
  }
});

test('the plan\'s own wording resolves to the right detail block', () => {
  // The extractor preserves the assessment's wording, so every real spelling must map.
  for (const spelling of ['Behavior Momentum', 'Behavioral Momentum', 'High-Probability Request Sequence']) {
    assert.match(buildInterventionDetail([spelling]), /BEHAVIOR MOMENTUM SPECIFICITY/,
      `a plan naming "${spelling}" must receive the Behavior Momentum detail`);
  }
});

test('no approved list -> no intervention detail at all', () => {
  assert.equal(buildInterventionDetail([]), '');
  assert.equal(buildInterventionDetail(null), '');
  assert.equal(buildInterventionDetail(undefined), '');
});

test('the static prompts no longer teach any intervention unconditionally', () => {
  // Every catalog intervention that has a detail block must appear ONLY via the conditional library.
  // A new unconditional mention in either prompt re-opens the hard-block bug, so this fails loudly.
  const named = [
    ['DRA DEFINITION', /DRA DEFINITION/],
    ['Behavior Momentum specificity', /BEHAVIOR MOMENTUM SPECIFICITY/],
    ['high-probability request pools', /Motor pool:|wider library, not just clapping hands/],
    ['Environmental Modification example', /implemented Environmental Modification by adjusting/],
    ['Token economy as a blanket reinforcer', /^- Token economy$/m],
  ];
  for (const [label, re] of named) {
    assert.ok(!re.test(MASTER_RBT_NOTE_PROMPT), `masterPrompt must not teach ${label} unconditionally`);
    assert.ok(!re.test(NOTE_PERFECTOR_PROMPT), `notePerfectorPrompt must not teach ${label} unconditionally`);
  }
});

test('NCR is documentable, not banned (it is approved in real plans and non-prohibited in the gate)', () => {
  for (const prompt of [MASTER_RBT_NOTE_PROMPT, NOTE_PERFECTOR_PROMPT]) {
    assert.ok(!/NEVER use NCR|NCR is not clinically appropriate|NCR.*COMPLETELY BANNED/i.test(prompt),
      'the blanket NCR ban contradicted plans that approve it and must not return');
  }
  assert.match(buildInterventionDetail(['NCR']), /NONCONTINGENT REINFORCEMENT/);
  assert.match(buildInterventionDetail(['Noncontingent Reinforcement']), /NONCONTINGENT REINFORCEMENT/);
});

test('every detail key is a real gate canonical name (keys cannot silently go dead)', async () => {
  const { INTERVENTION_CATALOG } = await import('./interventionPolicy.ts');
  const canonical = new Set(INTERVENTION_CATALOG.map((e) => e.canonical));
  for (const key of Object.keys(INTERVENTION_DETAIL)) {
    assert.ok(canonical.has(key), `"${key}" is not a canonical intervention name — its block would never emit`);
  }
});
