// Combined compliance gate (consolidation). Run: `npm test`.
//
// The contract these tests lock: the four compliance checks (intervention, approved-function, coverage,
// teaching-method) regenerate AT MOST ONCE, combined — never the old 3-4 sequential regens. A clean note
// costs zero regens; a note defective in ANY number of ways costs EXACTLY ONE regen whose instruction names
// every defect. The intervention survivor is surfaced for the caller to THROW; the other three survivors
// are surfaced for the caller to FLAG.

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
  functionViolations: [],
  coverage: { segmentable: true, missing: [] },
  methodViolations: [],
  approvedInterventions: ['DRA', 'Extinction'],
  approvedMethodSet: ['Modeling'],
  ...overrides,
});

// A note defective in all four ways at once.
const multiDefect = () => clean({
  intervention: { prohibited: ['RIRD'], unapproved: [], skillAsReduction: [] },
  functionViolations: [{ name: 'Throwing Objects', wrote: 'Automatic', approved: ['escape', 'tangible'] }],
  coverage: { segmentable: true, missing: [{ name: 'Off-Task Behavior' }] },
  methodViolations: ['DTT'],
});

test('clean state → no combined instruction (null)', () => {
  assert.equal(buildComplianceRegenInstruction(clean()), null);
});

test('MARLON REQUIRED: a multi-defect note yields ONE combined instruction naming EVERY violation', () => {
  const instr = buildComplianceRegenInstruction(multiDefect());
  assert.ok(instr, 'defective note produces an instruction');
  // A single instruction string (not one per gate) — the structural proof of one combined regen.
  assert.equal(typeof instr, 'string');
  // Every gate that failed is represented.
  assert.ok(instr.includes('FUNCTION COVERAGE'), 'coverage section present');
  assert.ok(instr.includes('Off-Task Behavior'), 'names the missing-function ABC');
  assert.ok(instr.includes('APPROVED FUNCTION'), 'approved-function section present');
  assert.ok(instr.includes('Throwing Objects'), 'names the mis-assigned behavior');
  assert.ok(instr.includes('APPROVED INTERVENTIONS'), 'intervention section present');
  assert.ok(instr.includes('RIRD'), 'names the prohibited intervention');
  assert.ok(instr.includes('TEACHING METHODS'), 'teaching-method section present');
  assert.ok(instr.includes('DTT'), 'names the unapproved method');
});

test('combined instruction order: coverage → function → interventions → methods (reinforcing, no conflict)', () => {
  const instr = buildComplianceRegenInstruction(multiDefect());
  const iCoverage = instr.indexOf('FUNCTION COVERAGE');
  const iFunction = instr.indexOf('APPROVED FUNCTION');
  const iIntervention = instr.indexOf('APPROVED INTERVENTIONS');
  const iMethod = instr.indexOf('TEACHING METHODS');
  assert.ok(iCoverage < iFunction && iFunction < iIntervention && iIntervention < iMethod,
    'coverage + function lead (both about the function, complementary), then interventions, then methods');
  // No uniqueness "vary the phrasing" pull anywhere (removed in Bug 6) → no Bug-3-style conflict.
  assert.ok(!/vary the (wording|phrasing)/i.test(instr), 'no "vary the wording" instruction to fight coverage');
});

test('a single-defect note still yields ONE instruction with only that section (unchanged 1-regen behavior)', () => {
  const instr = buildComplianceRegenInstruction(clean({ methodViolations: ['DTT'] }));
  assert.ok(instr.includes('TEACHING METHODS'));
  assert.ok(!instr.includes('FUNCTION COVERAGE'));
  assert.ok(!instr.includes('APPROVED INTERVENTIONS'));
});

test('MARLON REQUIRED: multi-defect note → regenCount EXACTLY 1 (not 2+), regenerate called once', async () => {
  let detectCalls = 0;
  // Defective on the first note; the single regen fixes everything.
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
  // The one instruction named every violation.
  assert.ok(capturedInstruction.includes('FUNCTION COVERAGE'));
  assert.ok(capturedInstruction.includes('APPROVED FUNCTION'));
  assert.ok(capturedInstruction.includes('APPROVED INTERVENTIONS'));
  assert.ok(capturedInstruction.includes('TEACHING METHODS'));
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
  // Still violating the intervention gate even after the rewrite (the hard-stop path).
  const detect = () => multiDefect();
  let regenCalls = 0;
  const result = await runCombinedComplianceGate({
    initialNote: 'INITIAL',
    detect,
    regenerate: async () => { regenCalls++; return 'STILL BAD'; },
  });
  assert.equal(result.regenCount, 1, 'one regen even when the violation persists — no second combined retry');
  assert.equal(regenCalls, 1, 'never a second regen for a persistent violation');
  const surviving = interventionViolationNames(result.state.intervention);
  assert.deepEqual(surviving, ['RIRD'], 'the surviving intervention is surfaced for the caller to THROW');
});

test('non-intervention survivors after the regen → final state carries them (caller FLAGS), still ONE regen', async () => {
  // Only the three flaggable gates persist; intervention is clean, so the caller would flag (never throw).
  const persist = () => clean({
    functionViolations: [{ name: 'Throwing Objects', wrote: 'Automatic', approved: ['escape'] }],
    coverage: { segmentable: true, missing: [{ name: 'Off-Task Behavior' }] },
    methodViolations: ['DTT'],
  });
  let regenCalls = 0;
  const result = await runCombinedComplianceGate({
    initialNote: 'INITIAL',
    detect: () => persist(),
    regenerate: async () => { regenCalls++; return 'STILL FLAGGED'; },
  });
  assert.equal(result.regenCount, 1);
  assert.equal(regenCalls, 1);
  assert.equal(interventionViolationNames(result.state.intervention).length, 0, 'no intervention throw');
  assert.equal(result.state.functionViolations.length, 1, 'approved-function survivor surfaced to flag');
  assert.deepEqual(result.state.coverage.missing.map((m) => m.name), ['Off-Task Behavior'], 'coverage survivor surfaced');
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

test('an unsegmentable note does NOT force a coverage regen (missing is empty when not segmentable)', () => {
  // Coverage only contributes a section when the note is segmentable AND has missing ABCs — an
  // unsegmentable note is surfaced as a flag by the caller, not regenerated blindly.
  const instr = buildComplianceRegenInstruction(clean({ coverage: { segmentable: false, missing: [] } }));
  assert.equal(instr, null, 'unsegmentable + otherwise clean → no combined regen');
});

// ── summarizeSurvivingViolations: the gateClean metric ───────────────────────────────────────────
// `clean` is the pass rate the admin feed is computed from, so its definition is pinned here — a
// silent drift in what counts as "clean" would silently move every number derived from it.

test('summarize: a clean state is clean and names no violations', () => {
  const { clean: isClean, violations } = summarizeSurvivingViolations(clean());
  assert.equal(isClean, true);
  assert.deepEqual(violations, {
    prohibited: [], unapproved: [], skillAsReduction: [],
    approvedFunction: [], teachingMethod: [], coverageMissing: [], unsegmentable: false,
  });
});

test('summarize: a multi-defect state is not clean and reports every bucket', () => {
  const { clean: isClean, violations } = summarizeSurvivingViolations(multiDefect());
  assert.equal(isClean, false);
  assert.deepEqual(violations.prohibited, ['RIRD']);
  assert.deepEqual(violations.approvedFunction, ['Throwing Objects'], 'behavior name only, not the triple');
  assert.deepEqual(violations.coverageMissing, ['Off-Task Behavior']);
  assert.deepEqual(violations.teachingMethod, ['DTT']);
  assert.equal(violations.unsegmentable, false);
});

test('summarize: EACH bucket alone is enough to make a note not clean', () => {
  const cases = [
    ['prohibited', clean({ intervention: { prohibited: ['RIRD'], unapproved: [], skillAsReduction: [] } })],
    ['unapproved', clean({ intervention: { prohibited: [], unapproved: ['Guided Compliance'], skillAsReduction: [] } })],
    ['skillAsReduction', clean({ intervention: { prohibited: [], unapproved: [], skillAsReduction: ['FCT'] } })],
    ['approvedFunction', clean({ functionViolations: [{ name: 'Elopement', wrote: 'Automatic', approved: ['escape'] }] })],
    ['teachingMethod', clean({ methodViolations: ['DTT'] })],
    ['coverageMissing', clean({ coverage: { segmentable: true, missing: [{ name: 'Elopement' }] } })],
  ];
  for (const [label, state] of cases) {
    assert.equal(summarizeSurvivingViolations(state).clean, false, `${label} alone must not be clean`);
  }
});

test('summarize: UNSEGMENTABLE is not clean — unverifiable must never count as passed', () => {
  // The pass rate stays conservative: coverage could not be checked, so the note is not known-good.
  // Reported on its own key so "could not verify" stays separable from "actually defective".
  const { clean: isClean, violations } = summarizeSurvivingViolations(
    clean({ coverage: { segmentable: false, missing: [] } }),
  );
  assert.equal(isClean, false, 'an unsegmentable note must not be counted as a clean pass');
  assert.equal(violations.unsegmentable, true);
  assert.deepEqual(violations.coverageMissing, [], 'no missing names are claimed when nothing could be checked');
  assert.deepEqual(violations.prohibited, [], 'and no other bucket is fabricated');
});
