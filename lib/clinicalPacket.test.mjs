// Clinical Extraction Packet — locate clinical regions across the WHOLE document, under the 90K budget. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClinicalPacket, PACKET_BUDGET } from './clinicalPacket.ts';

// Build a Felix-like 250K-char document with the authoritative content deliberately placed LATE — exactly the
// layout the old 90K cut excludes (behaviors early, DISCONTINUED blocks ~99-101K, MAS ~153K, FAST ~241K).
function felixFixture() {
  let t = '';
  const pad = (target) => { while (t.length < target) t += 'ongoing clinical narrative filler describing the session and context. '; };

  t += 'RECIPIENT: Felix\nDIAGNOSIS: Autism Spectrum Disorder (F84.0)\nChanges made during this authorization: two behaviors discontinued.\n';
  pad(2000);
  t += '\nMaladaptive Behaviors Summary\nThe target behaviors to reduce include Tantrums, Elopement, and others.\n';
  pad(8000);
  t += '\nOperational definition of behaviors (detailed behavior programs):\nTantrums — defined as crying and dropping to the floor. Status: active.\n';
  pad(20000);
  t += '\nIsolation — defined as the client withdrawing from peers and adults; new target added 04/01/2026. Status: active.\n';
  pad(40000);
  t += '\nElopement — leaving the area without warning. Status: active.\n';
  pad(99000);
  t += '\nClimbing\nStatus: Discontinued (07/02/2026). Operational definition: climbing on furniture.\n';
  pad(100500);
  t += '\nLining up Objects\nStatus: Discontinued (07/02/2026). Operational definition: arranging objects in a line.\n';
  pad(130000);
  t += '\nReplacement Behaviors Summary\nRequest Break, Manding for Attention, and others.\n';
  pad(153000);
  t += '\nAssessments Conducted\nMotivation Assessment Scale (MAS)\nBehavior | Escape | Attention | Tangible | Sensory | Automatic Reinforcement\nTantrums | 2 | 8 | 1 | 0 | 3\n';
  pad(200000);
  t += '\nReinforcers: tablet, bubbles, high five.\n';
  pad(241000);
  t += '\nFunctional Analysis Screening Tool (FAST)\nEscape Attention Tangible Sensory Automatic Reinforcement\nElopement scores highest on Escape.\n';
  pad(250000);
  return t;
}

test('MARLON FELIX FIXTURE: the packet traverses the whole document (all four late/early regions present)', () => {
  const text = felixFixture();
  assert.ok(text.length > 240000, `fixture is large: ${text.length}`);
  const r = buildClinicalPacket(text);

  // the four things the old 90K cut excludes:
  assert.ok(/Isolation/.test(r.packet), 'Isolation (early ~20K) present');
  assert.ok(/Climbing[\s\S]{0,120}Discontinued/i.test(r.packet), 'Climbing DISCONTINUED block (~99K) present');
  assert.ok(/Lining up Objects[\s\S]{0,120}Discontinued/i.test(r.packet), 'Lining up Objects DISCONTINUED block (~100K) present');
  assert.ok(/Motivation Assessment Scale/i.test(r.packet) || /Functional Analysis Screening/i.test(r.packet), 'a functional table (MAS/FAST) present');

  // the two separate confidences
  assert.equal(r.behaviorDomainFound, true, 'behavior domain located');
  assert.equal(r.hasFunctionalAssessment, true, 'functional assessment located');

  // size: UNDER the old 90K
  assert.ok(r.totalChars <= PACKET_BUDGET, `packet ${r.totalChars} within budget ${PACKET_BUDGET}`);
  assert.ok(r.totalChars < 90000, 'packet is smaller than the old 90K cut');

  // manifest is auditable (anchorMatched + confidence)
  const fa = r.manifest.find((m) => m.key === 'functionalAssessment');
  assert.ok(fa.found && fa.anchorMatched, `FA manifest records the anchor: ${fa.anchorMatched}`);
  assert.ok(['strong', 'weak'].includes(r.manifest.find((m) => m.key === 'behaviorDetail').confidence));
});

test('FA requires a heading: a column signature WITHOUT a FAST/MAS heading is NOT counted (conservative provenance)', () => {
  let t = 'Maladaptive Behaviors Summary\nTantrums. Status: active.\n';
  while (t.length < 5000) t += 'filler behavior narrative. ';
  t += '\nBehavior | Escape | Attention | Tangibles | Sensory | Automatic\nTantrums high on escape.\n'; // columns, but no MAS/FAST heading
  const r = buildClinicalPacket(t);
  assert.equal(r.hasFunctionalAssessment, false, 'no FA heading → not treated as a documented functional assessment');
});

test('FA detected when a heading (MAS/FAST) sits with the function columns', () => {
  let t = 'Maladaptive Behaviors Summary\nTantrums. Status: active.\n';
  while (t.length < 5000) t += 'filler behavior narrative. ';
  t += '\nMotivation Assessment Scale (MAS)\nBehavior | Escape | Attention | Tangible | Sensory | Automatic\nTantrums high on escape.\n';
  const r = buildClinicalPacket(t);
  assert.equal(r.hasFunctionalAssessment, true, 'heading + columns → documented functional assessment');
});

test('separate confidences: clear behaviors but NO functional assessment → domain found, FA missing', () => {
  const t = 'Maladaptive Behaviors Summary\nThe target behaviors to reduce: Tantrums (Status: active), Elopement (Status: active).\nOperational definition: crying; leaving area.\n';
  const r = buildClinicalPacket(t);
  assert.equal(r.behaviorDomainFound, true);
  assert.equal(r.hasFunctionalAssessment, false, 'no FAST/MAS present');
  assert.ok(r.missing.some((x) => /functional/i.test(x)), 'FA flagged missing (functions will be inferred, not blocking)');
});

test('essential domain missing → behaviorDomainFound false (caller preserves via the guard)', () => {
  let t = 'Reinforcers: tablet, bubbles.\n';
  while (t.length < 3000) t += 'unrelated narrative with no behavior domain. ';
  const r = buildClinicalPacket(t);
  assert.equal(r.behaviorDomainFound, false);
  assert.ok(r.missing.some((x) => /maladaptive|behavior/i.test(x)));
});

test('small document (under budget) is passed through whole; manifest still computed', () => {
  const t = 'Maladaptive Behaviors Summary\nTantrums. Status: active.\nMotivation Assessment Scale\nEscape Attention Tangible Sensory Automatic\n';
  const r = buildClinicalPacket(t);
  assert.ok(r.totalChars <= PACKET_BUDGET);
  assert.equal(r.behaviorDomainFound, true);
  assert.equal(r.hasFunctionalAssessment, true);
});

test('MARLON RESERVED BUDGET: replacement summary is GUARANTEED even when behavior detail is huge', () => {
  // Behavior detail alone would blow the budget; the replacement-program summary must still make it in.
  let t = 'Maladaptive Behaviors Summary\nTantrums (active), Elopement (active).\n';
  t += '\nOperational definition of behaviors:\n';
  while (t.length < 120000) t += 'a very long operational definition of the behavior with much detail. '; // >budget of prose
  t += '\nReplacement Behaviors Summary\nRequest Break, Manding for Attention, Movement Break Request, Transition Request, Following Instructions.\n';
  while (t.length < 200000) t += 'trailing replacement program procedure detail. ';
  const r = buildClinicalPacket(t);
  assert.ok(r.totalChars <= PACKET_BUDGET, `under budget: ${r.totalChars}`);
  assert.equal(r.replacementDomainFound, true, 'replacement domain guaranteed despite huge behavior detail');
  assert.ok(/Request Break/.test(r.packet) && /Transition Request/.test(r.packet), 'replacement program names present');
  assert.equal(r.behaviorDomainFound, true);
});

test('replacementDomainFound=false when there is no replacement domain', () => {
  const t = 'Maladaptive Behaviors Summary\nTantrums (active). Operational definition: crying.\n';
  const r = buildClinicalPacket(t);
  assert.equal(r.behaviorDomainFound, true);
  assert.equal(r.replacementDomainFound, false);
  assert.ok(r.missing.some((x) => /replacement/i.test(x)));
});

test('empty text → empty packet, nothing found (fails safe)', () => {
  const r = buildClinicalPacket('');
  assert.equal(r.behaviorDomainFound, false);
  assert.equal(r.hasFunctionalAssessment, false);
  assert.equal(r.totalChars, 0);
});
