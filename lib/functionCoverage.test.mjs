// FUNCTION-COVERAGE GATE (Bug 3). Run: `npm test`. Node's built-in runner, no deps.
//
// findMissingFunctionABCs(note, behaviors, skillNames) checks that EACH ABC STATES a documented function
// in its PROSE (RULE A). It is SEPARATE from the approved-set (validity) gate. The load-bearing cases are
// 7 (skill prose must not satisfy an ABC), 8 (metadata must not satisfy an ABC), and 11 (unrecognized
// skill-transition wording must segment via the skill NAME or fail loud — never misattribute skill prose).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMissingFunctionABCs, deriveBehaviorFunction, functionToCanonical, normalizeApprovedFunctions,
} from './functionPatterns.ts';

// Five behaviors whose name/topography words appear (reworded) in the ABC prose below.
const BEHAVIORS = [
  { name: 'Disruptive Behavior', topography: 'banging the table' },
  { name: 'Off-Task Behavior', topography: 'looking around the room' },
  { name: 'Social Isolation', topography: 'moving away from peers' },
  { name: 'Self-Injurious Behavior', topography: 'hitting own head' },
  { name: 'Inattention', topography: 'staring at the wall' },
];
const SKILLS = ['Manding for Attention Response', 'Help Request Response'];

// Skill-acquisition tail (uses a RECOGNIZED marker + names the skills verbatim).
const SKILL_TAIL =
  ' In addition to behavior-reduction programming, skill acquisition targeted Manding for Attention Response and Help Request Response, and the client responded with verbal prompting.';

// One ABC clause: a topography sentence, an optional function phrase, then a response.
const abc = (topo, fn) =>
  (fn ? `${topo}, ${fn}; the RBT responded and the client re-engaged.`
      : `${topo}; the RBT responded and the client re-engaged.`);

const TOPO = [
  'During the group activity, the client began banging the table',
  'As the worksheet was introduced, the client kept looking around the room',
  'When peers gathered, the client kept moving away from peers',
  'During independent play, the client began hitting own head',
  'Near the end, the client kept staring at the wall',
];
const FN = {
  attention: 'consistent with the documented attention function',
  escape: 'reflecting the documented escape function',
  tangible: 'aligned with the documented tangible function',
  automatic: 'consistent with the documented automatic-reinforcement function',
};

// Build a note from a function-per-ABC array (null = that ABC omits the function). tail defaults to the
// recognized skill tail; pass a custom tail for the skill/transition-wording tests.
const buildNote = (fns, tail = SKILL_TAIL) =>
  TOPO.map((t, i) => abc(t, fns[i])).join(' ') + tail;

const missingNames = (cov) => cov.missing.map((m) => m.name).sort();

test('1: 5/5 — every ABC names a function → pass, nothing missing', () => {
  const cov = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, FN.attention, FN.automatic, FN.escape]), BEHAVIORS, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.deepEqual(cov.missing, []);
  assert.equal(cov.results.filter((r) => r.present).length, 5);
});

test('2: 4/5 — one ABC missing the function → fail, the absent one listed', () => {
  const cov = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, null, FN.automatic, FN.escape]), BEHAVIORS, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.deepEqual(missingNames(cov), ['Social Isolation']);
});

test('3: 1/5 (the live regression) — only one ABC names a function → 4 listed', () => {
  const cov = findMissingFunctionABCs(buildNote([null, null, null, FN.automatic, null]), BEHAVIORS, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.deepEqual(missingNames(cov),
    ['Disruptive Behavior', 'Inattention', 'Off-Task Behavior', 'Social Isolation']);
});

test('4: 0/5 — no ABC names a function → all listed', () => {
  const cov = findMissingFunctionABCs(buildNote([null, null, null, null, null]), BEHAVIORS, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.equal(cov.missing.length, 5);
});

test('5: 5/5 present but one function NOT approved → coverage PASSES; validity gate catches it', () => {
  // Behavior 1 (approved: Attention only) is written with the ESCAPE function. Coverage only asks
  // "is a function present?" — it is → passes. The SEPARATE approved-set gate is what flags the mismatch.
  const note = buildNote([FN.escape, FN.escape, FN.attention, FN.automatic, FN.escape]);
  const cov = findMissingFunctionABCs(note, BEHAVIORS, SKILLS);
  assert.deepEqual(cov.missing, [], 'coverage passes — a function IS present in every ABC');

  // Validity is a distinct check (the same helpers the generateSmartNote approved-set gate uses):
  const wrote = deriveBehaviorFunction(abc(TOPO[0], FN.escape), {}).resolved; // 'Escape'
  const approvedForB1 = normalizeApprovedFunctions(['attention']);
  assert.ok(!approvedForB1.has(functionToCanonical(wrote)),
    'the written Escape is NOT in behavior 1\'s approved {attention} — validity gate would flag it');
});

test('6: 5/5 with the automatic-reinforcement wording → pass', () => {
  const cov = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, FN.tangible, FN.automatic, FN.escape]), BEHAVIORS, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.deepEqual(cov.missing, []);
  // the automatic ABC specifically resolves (gate-compatible "automatic-reinforcement function")
  assert.equal(deriveBehaviorFunction(abc(TOPO[3], FN.automatic), {}).resolved, 'Automatic Reinforcement');
});

test('7 (load-bearing): function in the SKILL paragraph but ABC5 has none → ABC5 FAILS', () => {
  // ABC5 omits the function; the skill tail contains "escape function". The gate must NOT let skill prose
  // satisfy ABC5 — ABC5 ends at the skill boundary.
  const tail = ' In addition to behavior-reduction programming, skill acquisition targeted Manding for Attention Response and Help Request Response, consistent with the documented escape function throughout.';
  const cov = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, FN.attention, FN.automatic, null], tail), BEHAVIORS, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.deepEqual(missingNames(cov), ['Inattention'], 'skill-paragraph function does not count for ABC5');
});

test('8 (load-bearing): function in behavior METADATA but absent from ABC text → FAILS', () => {
  // Behavior 5 carries function/antecedent metadata, but ABC5 prose names no function. Because presence is
  // measured with deriveBehaviorFunction(window, {}) — empty behavior — metadata is never consulted.
  const behaviorsWithMeta = BEHAVIORS.map((b, i) =>
    i === 4 ? { ...b, function: 'escape', antecedent: 'presented with a task demand', evidencedBy: 'escape-maintained' } : b);
  const cov = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, FN.attention, FN.automatic, null]), behaviorsWithMeta, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.deepEqual(missingNames(cov), ['Inattention'], 'metadata does not count — only the ABC prose does');
});

test('9: a behavior whose topography never appears → that behavior FAILS (couldn\'t locate its ABC)', () => {
  // Replace behavior 3 with one never described in the note; its anchor is not found.
  const behaviors = BEHAVIORS.map((b, i) => (i === 2 ? { name: 'Elopement', topography: 'sprinting through the doorway' } : b));
  const cov = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, FN.attention, FN.automatic, FN.escape]), behaviors, SKILLS);
  assert.equal(cov.segmentable, true);
  assert.ok(missingNames(cov).includes('Elopement'), 'the un-anchored behavior fails, never a silent pass');
});

test('10: degenerate / no behavior locatable → segmentable=false (fail loud, not pass)', () => {
  assert.equal(findMissingFunctionABCs('', BEHAVIORS, SKILLS).segmentable, false);
  const noneMatch = 'The weather was pleasant and the room was quiet throughout the visit.';
  assert.equal(findMissingFunctionABCs(noneMatch, BEHAVIORS, SKILLS).segmentable, false);
});

test('11 (load-bearing): UNRECOGNIZED transition wording that names its skills → segments via the skill anchor', () => {
  // "Following the reduction targets, we worked on ..." is NOT in the marker whitelist — but the skill NAME
  // is present, so the boundary is found structurally (phrase-independent) and a valid 5/5 note PASSES.
  const novelTail = ' Following the reduction targets, we worked on Manding for Attention Response and Help Request Response with verbal prompting.';
  const cov = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, FN.attention, FN.automatic, FN.escape], novelTail), BEHAVIORS, SKILLS);
  assert.equal(cov.segmentable, true, 'skill NAME anchors the boundary regardless of transition wording');
  assert.deepEqual(cov.missing, [], 'valid 5/5 note is not falsely failed');

  // Sibling: same novel wording but NO anchorable skill (skillNames empty) and no recognized marker →
  // segmentable=false. It must fail loud, never scan to end and misattribute skill prose to ABC5.
  const sib = findMissingFunctionABCs(buildNote([FN.attention, FN.escape, FN.attention, FN.automatic, FN.escape], novelTail), BEHAVIORS, []);
  assert.equal(sib.segmentable, false, 'no skill anchor + unrecognized wording → fail loud, no false pass');
});
