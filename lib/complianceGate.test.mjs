// Combined compliance gate (consolidation). Run: `npm test`.
//
// The contract these tests lock: the gate is driven by TWO whole-note checks — intervention and
// teaching-method — that regenerate AT MOST ONCE, combined. A clean note costs zero regens; a note
// defective in either (or both) ways costs EXACTLY ONE regen whose instruction names every defect. The
// intervention survivor is surfaced for the caller to THROW; the teaching-method survivor to FLAG.
//
// REMOVED 2026-09-06: the approved-function (validity) and function-coverage checks used to drive this gate
// too. Both read a per-behavior segmentation that misattributes ABC boundaries, so they fired on CORRECT
// notes and drove spurious extra regenerations. These tests PROVE they no longer produce any repair — even
// when their (now-vestigial) state fields are populated — and that only intervention + method drive `clean`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComplianceRegenInstruction,
  runCombinedComplianceGate,
  interventionViolationNames,
  summarizeSurvivingViolations,
} from './complianceGate.ts';

const clean = (overrides = {}) => ({
  intervention: { prohibited: [], unapproved: [], skillAsReduction: [] },
  methodViolations: [],
  approvedInterventions: ['DRA', 'Extinction'],
  approvedMethodSet: ['Modeling'],
  ...overrides,
});

// A note defective in both whole-note ways at once.
const multiDefect = () => clean({
  intervention: { prohibited: ['RIRD'], unapproved: [], skillAsReduction: [] },
  methodViolations: ['DTT'],
});

test('clean state → no combined instruction (null)', () => {
  assert.equal(buildComplianceRegenInstruction(clean()), null);
});

// MARLON REQUIRED: coverage/validity are OFF the repair path. Even if a caller passes the old (now vestigial)
// state fields populated, they must NEVER produce an instruction — only intervention + method do.
test('MARLON REQUIRED: a coverage or validity finding ALONE produces NO repair', () => {
  const coverageOnly = clean({ coverage: { segmentable: true, missing: [{ name: 'Off-Task Behavior' }] } });
  assert.equal(buildComplianceRegenInstruction(coverageOnly), null, 'coverage missing alone → no repair');

  const validityOnly = clean({ functionViolations: [{ name: 'Throwing Objects', wrote: 'Automatic', approved: ['escape'] }] });
  assert.equal(buildComplianceRegenInstruction(validityOnly), null, 'approved-function violation alone → no repair');

  const bothOnly = clean({
    coverage: { segmentable: false, missing: [] },
    functionViolations: [{ name: 'Elopement', wrote: 'Automatic', approved: ['escape'] }],
  });
  assert.equal(buildComplianceRegenInstruction(bothOnly), null, 'coverage + validity together, no whole-note defect → no repair');
});

test('MARLON REQUIRED: an intervention defect still repairs', () => {
  const instr = buildComplianceRegenInstruction(clean({ intervention: { prohibited: ['RIRD'], unapproved: [], skillAsReduction: [] } }));
  assert.ok(instr, 'intervention defect produces an instruction');
  assert.ok(instr.includes('APPROVED INTERVENTIONS'), 'intervention section present');
  assert.ok(instr.includes('RIRD'), 'names the prohibited intervention');
});

test('MARLON REQUIRED: a teaching-method defect still repairs', () => {
  const instr = buildComplianceRegenInstruction(clean({ methodViolations: ['DTT'] }));
  assert.ok(instr, 'teaching-method defect produces an instruction');
  assert.ok(instr.includes('TEACHING METHODS'), 'teaching-method section present');
  assert.ok(instr.includes('DTT'), 'names the unapproved method');
});

test('the removed clauses never appear in any instruction', () => {
  // Even a multi-defect note produces only the two surviving sections.
  const instr = buildComplianceRegenInstruction(multiDefect());
  assert.ok(!instr.includes('FUNCTION COVERAGE'), 'no coverage clause');
  assert.ok(!instr.includes('APPROVED FUNCTION'), 'no approved-function clause');
});

test('a multi-defect note yields ONE combined instruction naming BOTH whole-note violations', () => {
  const instr = buildComplianceRegenInstruction(multiDefect());
  assert.ok(instr, 'defective note produces an instruction');
  assert.equal(typeof instr, 'string', 'a single instruction string, not one per gate');
  assert.ok(instr.includes('APPROVED INTERVENTIONS'), 'intervention section present');
  assert.ok(instr.includes('RIRD'), 'names the prohibited intervention');
  assert.ok(instr.includes('TEACHING METHODS'), 'teaching-method section present');
  assert.ok(instr.includes('DTT'), 'names the unapproved method');
});

test('combined instruction order: interventions → methods', () => {
  const instr = buildComplianceRegenInstruction(multiDefect());
  const iIntervention = instr.indexOf('APPROVED INTERVENTIONS');
  const iMethod = instr.indexOf('TEACHING METHODS');
  assert.ok(iIntervention >= 0 && iMethod >= 0 && iIntervention < iMethod, 'interventions then methods');
  assert.ok(!/vary the (wording|phrasing)/i.test(instr), 'no "vary the wording" instruction');
});

test('a single-defect note yields ONE instruction with only that section', () => {
  const instr = buildComplianceRegenInstruction(clean({ methodViolations: ['DTT'] }));
  assert.ok(instr.includes('TEACHING METHODS'));
  assert.ok(!instr.includes('APPROVED INTERVENTIONS'));
});

test('MARLON REQUIRED: multi-defect note → regenCount EXACTLY 1 (not 2+), regenerate called once', async () => {
  let detectCalls = 0;
  const detect = () => (detectCalls++ === 0 ? multiDefect() : clean());
  let regenCalls = 0;
  let capturedInstruction = null;
  let regenMarkers = 0;
  const result = await runCombinedComplianceGate({
    initialNote: 'INITIAL NOTE',
    detect,
    regenerate: async (instruction) => { regenCalls++; capturedInstruction = instruction; return 'REGENERATED NOTE'; },
    onRegen: () => { regenMarkers++; },
  });
  assert.equal(result.regenCount, 1, 'exactly one combined regeneration — proves consolidation');
  assert.equal(regenCalls, 1, 'the LLM was called exactly once for the combined rewrite');
  assert.equal(regenMarkers, 1, 'exactly one __REGEN__ marker emitted');
  assert.equal(result.note, 'REGENERATED NOTE', 'returns the regenerated note');
  assert.equal(detectCalls, 2, 'detect ran on the initial note and once more on the regenerated note');
  assert.ok(capturedInstruction.includes('APPROVED INTERVENTIONS'));
  assert.ok(capturedInstruction.includes('TEACHING METHODS'));
});

test('MARLON REQUIRED: regenCount stays in {0,1} even when a defect persists through the regen', async () => {
  const result = await runCombinedComplianceGate({
    initialNote: 'INITIAL',
    detect: () => multiDefect(), // still defective after the rewrite
    regenerate: async () => 'STILL BAD',
  });
  assert.ok(result.regenCount === 0 || result.regenCount === 1, 'regenCount is always 0 or 1');
  assert.equal(result.regenCount, 1, 'one regen even when the violation persists — no second combined retry');
});

test('MARLON REQUIRED: a coverage/validity-only note → ZERO regens through the live gate', async () => {
  // Populate the vestigial fields; the gate must still see a clean note and never call regenerate.
  let regenCalls = 0;
  const result = await runCombinedComplianceGate({
    initialNote: 'CLEAN-EXCEPT-COVERAGE',
    detect: () => clean({
      coverage: { segmentable: true, missing: [{ name: 'Off-Task Behavior' }] },
      functionViolations: [{ name: 'Throwing Objects', wrote: 'Automatic', approved: ['escape'] }],
    }),
    regenerate: async () => { regenCalls++; return 'SHOULD NOT HAPPEN'; },
  });
  assert.equal(result.regenCount, 0, 'coverage/validity findings never drive a regen');
  assert.equal(regenCalls, 0, 'regenerate never called for a coverage/validity-only note');
});

test('clean note → ZERO regens, regenerate never called', async () => {
  let regenCalls = 0;
  let regenMarkers = 0;
  const result = await runCombinedComplianceGate({
    initialNote: 'CLEAN NOTE',
    detect: () => clean(),
    regenerate: async () => { regenCalls++; return 'SHOULD NOT HAPPEN'; },
    onRegen: () => { regenMarkers++; },
  });
  assert.equal(result.regenCount, 0);
  assert.equal(regenCalls, 0, 'a clean note never regenerates');
  assert.equal(regenMarkers, 0);
  assert.equal(result.note, 'CLEAN NOTE', 'the original note is returned unchanged');
});

test('intervention survivor after the combined regen → final state carries it (caller THROWS), still ONE regen', async () => {
  let regenCalls = 0;
  const result = await runCombinedComplianceGate({
    initialNote: 'INITIAL',
    detect: () => multiDefect(),
    regenerate: async () => { regenCalls++; return 'STILL BAD'; },
  });
  assert.equal(result.regenCount, 1, 'one regen even when the violation persists — no second combined retry');
  assert.equal(regenCalls, 1, 'never a second regen for a persistent violation');
  assert.deepEqual(interventionViolationNames(result.state.intervention), ['RIRD'], 'the surviving intervention is surfaced for the caller to THROW');
});

test('teaching-method survivor after the regen → final state carries it (caller FLAGS), still ONE regen', async () => {
  const persist = () => clean({ methodViolations: ['DTT'] });
  let regenCalls = 0;
  const result = await runCombinedComplianceGate({
    initialNote: 'INITIAL',
    detect: () => persist(),
    regenerate: async () => { regenCalls++; return 'STILL FLAGGED'; },
  });
  assert.equal(result.regenCount, 1);
  assert.equal(regenCalls, 1);
  assert.equal(interventionViolationNames(result.state.intervention).length, 0, 'no intervention throw');
  assert.deepEqual(result.state.methodViolations, ['DTT'], 'teaching-method survivor surfaced');
});

test('interventionViolationNames dedups across the three buckets', () => {
  const names = interventionViolationNames({
    prohibited: ['RIRD'],
    unapproved: ['RIRD', 'Guided Compliance'],
    skillAsReduction: ['FCT'],
  });
  assert.deepEqual([...names].sort(), ['FCT', 'Guided Compliance', 'RIRD']);
});

// ── summarizeSurvivingViolations: the gateClean metric ───────────────────────────────────────────
// `clean` is the pass rate the admin feed is computed from, so its definition is pinned here — a
// silent drift in what counts as "clean" would silently move every number derived from it. Since
// 2026-09-06 `clean` is driven ONLY by intervention + teaching-method; the segmentation-dependent
// fields were DELETED from SurvivingViolations, not zeroed.

test('summarize: a clean state is clean and names EXACTLY the four live buckets (deleted fields are absent, not zeroed)', () => {
  const { clean: isClean, violations } = summarizeSurvivingViolations(clean());
  assert.equal(isClean, true);
  // Exact shape: only the four whole-note buckets exist. A hardcoded empty approvedFunction/coverageMissing/
  // unsegmentable/coverageSuppressed would be a "no check ran" read as "no defect" — so they must be ABSENT.
  assert.deepEqual(violations, {
    prohibited: [], unapproved: [], skillAsReduction: [], teachingMethod: [],
  });
  for (const gone of ['approvedFunction', 'coverageMissing', 'unsegmentable', 'coverageSuppressed']) {
    assert.ok(!(gone in violations), `${gone} must be DELETED from the payload, not present as a zero`);
  }
});

test('summarize: a note defective ONLY in (ignored) coverage/validity input is clean and grows no keys', () => {
  // The removed checks are gone; passing their old input as stray properties must not move the metric NOR
  // reintroduce a key. Proves the deletion is real, not a rename.
  const { clean: isClean, violations } = summarizeSurvivingViolations(clean({
    coverage: { segmentable: true, missing: [{ name: 'Off-Task Behavior' }], suppressed: 'degenerate' },
    functionViolations: [{ name: 'Throwing Objects', wrote: 'Automatic', approved: ['escape'] }],
  }));
  assert.equal(isClean, true, 'a note defective ONLY in coverage/validity counts as clean — those checks are gone');
  assert.deepEqual(Object.keys(violations).sort(), ['prohibited', 'skillAsReduction', 'teachingMethod', 'unapproved']);
});

test('summarize: a multi-defect state is not clean and reports the two live buckets', () => {
  const { clean: isClean, violations } = summarizeSurvivingViolations(multiDefect());
  assert.equal(isClean, false);
  assert.deepEqual(violations.prohibited, ['RIRD']);
  assert.deepEqual(violations.teachingMethod, ['DTT']);
});

test('summarize: EACH live bucket alone is enough to make a note not clean', () => {
  const cases = [
    ['prohibited', clean({ intervention: { prohibited: ['RIRD'], unapproved: [], skillAsReduction: [] } })],
    ['unapproved', clean({ intervention: { prohibited: [], unapproved: ['Guided Compliance'], skillAsReduction: [] } })],
    ['skillAsReduction', clean({ intervention: { prohibited: [], unapproved: [], skillAsReduction: ['FCT'] } })],
    ['teachingMethod', clean({ methodViolations: ['DTT'] })],
  ];
  for (const [label, state] of cases) {
    assert.equal(summarizeSurvivingViolations(state).clean, false, `${label} alone must not be clean`);
  }
});
