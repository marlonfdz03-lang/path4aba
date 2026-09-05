// THE PRESELECTION INVARIANT (Commit 4). Run: `npm test`.
//
// Marlon's core property, tested BEFORE any rotation behaviour: LRU may REORDER only WITHIN a locked set; it
// can NEVER expand it. For arbitrary history and arbitrary approved sets, every preselected value is a member
// of its locked set. This is a property of the SELECTOR (code), never an instruction to GPT — which is what
// makes the class-A regenerations (unapproved function / intervention / method) structurally impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  preselect, lruPick, lruOrder, buildFixedAssignmentsBlock, FUNCTION_ANTECEDENTS, GENERAL_ABA_FUNCTION_INTERVENTIONS,
} from './preselect.ts';
import { TIER_PROMPTS, TIER_RESPONSES } from './complianceTiers.ts';
import { isWithholdResponseIntervention } from './behaviorSafety.ts';

test('a per-ABC/skill tier drives promptKey and responseKey within the tier vocab', () => {
  const r = preselect({
    behaviors: [{ name: 'B', allowedFunctions: ['escape'], topographies: ['t'] }],
    skills: [{ name: 'S' }],
    approvedInterventions: ['DRA'], approvedMethods: ['Modeling'],
    location: 'home', homeActivities: ['puzzle activity'], schoolActivities: [],
    behaviorTiers: ['DIFFICULT'], skillTiers: ['FAVORABLE'], history: [],
  });
  assert.equal(r.perBehavior.B.tier, 'DIFFICULT');
  assert.ok(TIER_PROMPTS.DIFFICULT.includes(r.perBehavior.B.promptKey), 'prompt ∈ DIFFICULT vocab');
  assert.ok(TIER_RESPONSES.DIFFICULT.includes(r.perBehavior.B.responseKey), 'response ∈ DIFFICULT vocab');
  assert.equal(r.perSkill.S.tier, 'FAVORABLE');
  assert.ok(TIER_PROMPTS.FAVORABLE.includes(r.perSkill.S.promptKey), 'skill prompt ∈ FAVORABLE vocab');
  assert.ok(buildFixedAssignmentsBlock(r).includes('outcome tier: DIFFICULT'), 'tier is in the block');
});

test('intervention: full-name approved list is matched to the general map via the canonicalizer', () => {
  // real-world full names must now match the map (they did NOT before — the live bug).
  const r = preselect({
    behaviors: [{ name: 'Elopement', allowedFunctions: ['escape'], topographies: ['t'] }],
    skills: [],
    approvedInterventions: [
      'Differential Reinforcement of Alternative Behavior (DRA)',
      'Redirection', 'Escape Extinction', 'Provide Choices',
    ],
    approvedMethods: ['Modeling'], location: 'home', homeActivities: ['puzzle activity'], schoolActivities: [],
    history: [],
  });
  // escape fits DRA (in the general map); Redirection/Escape Extinction/Provide Choices are not in it.
  assert.equal(r.perBehavior.Elopement.interventionName, 'Differential Reinforcement of Alternative Behavior (DRA)');
  assert.equal(r.perBehavior.Elopement.interventionFit, 'function-matched');
});

test('intervention no-fit: falls back to the approved list but is MARKED, not passed as function-matched', () => {
  // automatic function, approved list has NOTHING in the automatic general map ({NCR,DRO,DRI,Env Modification}).
  const r = preselect({
    behaviors: [{ name: 'Hand Flapping', allowedFunctions: ['automatic'], topographies: ['t'] }],
    skills: [],
    approvedInterventions: ['Redirection', 'Environmental Manipulations/Antecedent Manipulations', 'Provide Choices'],
    approvedMethods: ['Modeling'], location: 'home', homeActivities: ['puzzle activity'], schoolActivities: [],
    history: [],
  });
  // an intervention is still selected (the note needs one) but it is NOT function-matched
  assert.ok(['Redirection', 'Environmental Manipulations/Antecedent Manipulations', 'Provide Choices'].includes(r.perBehavior['Hand Flapping'].interventionName));
  assert.equal(r.perBehavior['Hand Flapping'].interventionFit, 'approved-global-fallback');
  assert.equal(r.interventionFit['Hand Flapping'], 'approved-global-fallback');
  // and the non-fit is surfaced for admin visibility
  assert.ok(r.integrityFlags.some((f) => f.includes('Hand Flapping') && f.includes('no approved intervention fits')));
  // "Environmental Manipulations" was NOT force-matched to the map's "Environmental Modification"
});

test('AUDITABILITY: assigned tiers are mirrored to top-level name→tier maps (for generation_context)', () => {
  const r = preselect({
    behaviors: [
      { name: 'Tantrums', allowedFunctions: ['escape'], topographies: ['t'] },
      { name: 'Throwing Objects', allowedFunctions: ['escape'], topographies: ['t'] },
    ],
    skills: [{ name: 'Request Break' }, { name: 'Manding' }],
    approvedInterventions: ['DRA'], approvedMethods: ['Modeling'],
    location: 'home', homeActivities: ['puzzle activity'], schoolActivities: [],
    behaviorTiers: ['FAVORABLE', 'DIFFICULT'], skillTiers: ['FAVORABLE', 'PARTIAL'], history: [],
  });
  assert.deepEqual(r.behaviorTiers, { 'Tantrums': 'FAVORABLE', 'Throwing Objects': 'DIFFICULT' });
  assert.deepEqual(r.skillTiers, { 'Request Break': 'FAVORABLE', 'Manding': 'PARTIAL' });
  // consistent with the per-item .tier the block reads
  assert.equal(r.perSkill['Request Break'].tier, r.skillTiers['Request Break']);
});

// ── Deterministic pseudo-random generators (no Math.random — it is unavailable and would break resume) ──
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

const FUNCTIONS = ['escape', 'attention', 'tangible', 'automatic'];
const ALL_INTERVENTIONS = ['DRA', 'DRI', 'FCT', 'NCR', 'DRO', 'Premack', 'Behavior Momentum', 'Redirection', 'Demand Fading', 'Planned Ignoring'];
const ALL_METHODS = ['Modeling', 'DTT', 'NET', 'Prompting', 'Chaining'];
const HOME = ['puzzle activity', 'coloring activity', 'toy play activity', 'table activity'];
const SCHOOL = ['circle time', 'independent work', 'group activity', 'academic worksheet activity'];
const TOPOS = ['tapping the table', 'propelling objects', 'vocalizing loudly'];

// Build an arbitrary history whose stored choices may be ANYTHING (even out-of-set values) — the selector
// must still never emit an out-of-set value.
function arbitraryHistory(rng, behaviorNames, skillNames) {
  const n = Math.floor(rng() * 4); // 0..3 notes
  const notes = [];
  for (let i = 0; i < n; i++) {
    const perBehavior = {};
    for (const b of behaviorNames) {
      perBehavior[b] = {
        function: pick(rng, [...FUNCTIONS, 'GARBAGE-FN', undefined]),
        interventionName: pick(rng, [...ALL_INTERVENTIONS, 'GARBAGE-INT', undefined]),
        antecedentKey: pick(rng, ['demand-presented', 'GARBAGE-ANT', undefined]),
        activity: pick(rng, [...HOME, ...SCHOOL, 'GARBAGE-ACT', undefined]),
        topography: pick(rng, [...TOPOS, undefined]),
        promptKey: pick(rng, ['verbal', 'model', 'GARBAGE-PROMPT', undefined]),
        responseKey: pick(rng, ['success', 'variable', undefined]),
      };
    }
    const perSkill = {};
    for (const s of skillNames) {
      perSkill[s] = { method: pick(rng, [...ALL_METHODS, 'GARBAGE-METHOD', undefined]), activity: pick(rng, [...HOME, 'GARBAGE', undefined]) };
    }
    notes.push({ source: 'generation_context', perBehavior, perSkill, activities: [] });
  }
  return notes;
}

test('MARLON REQUIRED: property — every axis stays within its locked set, for arbitrary history & sets', () => {
  const rng = makeRng(12345);
  for (let iter = 0; iter < 400; iter++) {
    const location = rng() < 0.5 ? 'home' : 'school';
    const activitySet = location === 'school' ? SCHOOL : HOME;

    // Arbitrary approved sets (non-empty), arbitrary per-behavior approved functions.
    const approvedInterventions = ALL_INTERVENTIONS.filter(() => rng() < 0.5);
    if (!approvedInterventions.length) approvedInterventions.push(pick(rng, ALL_INTERVENTIONS));
    const approvedMethods = ALL_METHODS.filter(() => rng() < 0.5);
    if (!approvedMethods.length) approvedMethods.push(pick(rng, ALL_METHODS));

    const behaviors = [];
    const nb = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < nb; i++) {
      const fns = FUNCTIONS.filter(() => rng() < 0.5);
      behaviors.push({ name: `B${i}`, allowedFunctions: rng() < 0.9 ? (fns.length ? fns : [pick(rng, FUNCTIONS)]) : [], topographies: TOPOS.filter(() => rng() < 0.6) });
    }
    const skills = [{ name: 'S0' }, { name: 'S1' }].filter(() => rng() < 0.7);

    const history = arbitraryHistory(rng, behaviors.map((b) => b.name), skills.map((s) => s.name));
    const compliance = pick(rng, ['typical', 'below_typical', 'poor', undefined]);

    const r = preselect({
      behaviors, skills, approvedInterventions, approvedMethods,
      location, homeActivities: HOME, schoolActivities: SCHOOL, complianceLevel: compliance, history,
    });

    for (const b of behaviors) {
      const a = r.perBehavior[b.name];
      if (a.function !== undefined) assert.ok(b.allowedFunctions.includes(a.function), `function ${a.function} ∈ approved for ${b.name}`);
      // intervention ∈ the client's approved interventions (fit only narrows within it) — OR undefined when the
      // clinical-safety filter emptied the pool (every approved option was withhold-response, unsafe for this
      // behavior), which is flagged via noSafeIntervention and never falls through to picking one anyway.
      if (a.interventionName !== undefined) {
        assert.ok(approvedInterventions.includes(a.interventionName), `intervention ${a.interventionName} ∈ approved`);
        // CLINICAL SAFETY: B0..B2 are unclassified → fail-safe → NEVER a withhold-response intervention.
        assert.ok(!isWithholdResponseIntervention(a.interventionName), `no withhold-response for ${b.name}`);
      } else {
        assert.equal(a.noSafeIntervention, true, `undefined intervention only via the noSafeIntervention flag`);
      }
      if (a.antecedentKey !== undefined) assert.ok(FUNCTION_ANTECEDENTS[a.function].includes(a.antecedentKey), `antecedent ∈ ${a.function} pool`);
      if (a.activity !== undefined) assert.ok(activitySet.includes(a.activity), `activity ∈ ${location} set`);
      if (a.topography !== undefined) assert.ok(b.topographies.includes(a.topography), `topography ∈ assessment set`);
      // A behavior with NO approved function must produce NO function and NO antecedent, and a flag.
      if (!b.allowedFunctions.length) {
        assert.equal(a.function, undefined);
        assert.equal(a.antecedentKey, undefined);
        assert.ok(r.integrityFlags.some((f) => f.includes(b.name)), 'empty-function behavior is flagged');
      }
    }
    for (const s of skills) {
      const a = r.perSkill[s.name];
      if (a.method !== undefined) assert.ok(approvedMethods.includes(a.method), `method ${a.method} ∈ approved`);
      if (a.activity !== undefined) assert.ok(activitySet.includes(a.activity), `skill activity ∈ ${location} set`);
    }
  }
});

test('MARLON REQUIRED: [DRA, Redirection] can NEVER become Behavior Momentum, whatever the history', () => {
  const approvedInterventions = ['DRA', 'Redirection'];
  const behaviors = [{ name: 'Throwing Objects', allowedFunctions: ['escape'], topographies: ['propelling objects'] }];
  // History that used DRA and Redirection repeatedly, and even (impossibly) recorded Behavior Momentum.
  const history = [
    { source: 'generation_context', perBehavior: { 'Throwing Objects': { interventionName: 'DRA', function: 'escape' } }, perSkill: {}, activities: [] },
    { source: 'generation_context', perBehavior: { 'Throwing Objects': { interventionName: 'Behavior Momentum', function: 'escape' } }, perSkill: {}, activities: [] },
    { source: 'generation_context', perBehavior: { 'Throwing Objects': { interventionName: 'Redirection', function: 'escape' } }, perSkill: {}, activities: [] },
  ];
  for (let i = 0; i < 50; i++) {
    const r = preselect({
      behaviors, skills: [], approvedInterventions, approvedMethods: ['Modeling'],
      location: 'home', homeActivities: HOME, schoolActivities: SCHOOL, history,
    });
    const chosen = r.perBehavior['Throwing Objects'].interventionName;
    assert.ok(chosen === 'DRA' || chosen === 'Redirection', `chose ${chosen} — must be in the approved pair`);
    assert.notEqual(chosen, 'Behavior Momentum');
  }
});

test('single-function behavior always uses its one function (nothing to rotate)', () => {
  const r = preselect({
    behaviors: [{ name: 'Fidgeting', allowedFunctions: ['automatic'], topographies: ['tapping'] }],
    skills: [], approvedInterventions: ['NCR'], approvedMethods: ['Modeling'],
    location: 'home', homeActivities: HOME, schoolActivities: SCHOOL,
    history: [{ source: 'generation_context', perBehavior: { Fidgeting: { function: 'automatic' } }, perSkill: {}, activities: [] }],
  });
  assert.equal(r.perBehavior.Fidgeting.function, 'automatic');
});

test('LRU rotates: a multi-function behavior avoids the function used last note', () => {
  const behaviors = [{ name: 'Throwing Objects', allowedFunctions: ['escape', 'tangible'], topographies: ['propelling objects'] }];
  const base = { behaviors, skills: [], approvedInterventions: ['DRA'], approvedMethods: ['Modeling'], location: 'home', homeActivities: HOME, schoolActivities: SCHOOL };
  const afterEscape = preselect({ ...base, history: [{ source: 'generation_context', perBehavior: { 'Throwing Objects': { function: 'escape' } }, perSkill: {}, activities: [] }] });
  assert.equal(afterEscape.perBehavior['Throwing Objects'].function, 'tangible', 'rotates away from the just-used function');
  const afterTangible = preselect({ ...base, history: [{ source: 'generation_context', perBehavior: { 'Throwing Objects': { function: 'tangible' } }, perSkill: {}, activities: [] }] });
  assert.equal(afterTangible.perBehavior['Throwing Objects'].function, 'escape');
});

test('legacy UNKNOWN axis contributes nothing: activity rotation ignores a legacy note', () => {
  // A legacy note (activities undefined, per-behavior activity undefined) must not count as "used".
  const behaviors = [{ name: 'B', allowedFunctions: ['escape'], topographies: ['t'] }];
  const legacy = [{ source: 'derived', perBehavior: { B: { function: 'escape' } }, perSkill: {}, activities: undefined }];
  const base = { behaviors, skills: [], approvedInterventions: ['DRA'], approvedMethods: ['Modeling'], location: 'home', homeActivities: HOME, schoolActivities: SCHOOL };
  const withLegacy = preselect({ ...base, history: legacy });
  const noHistory = preselect({ ...base, history: [] });
  // THE INTENT: a legacy note whose activity is UNKNOWN is NOT evidence — the pick must be identical to the
  // no-history pick (the legacy note contributed nothing to the activity axis).
  assert.equal(withLegacy.perBehavior.B.activity, noHistory.perBehavior.B.activity);
  // The pick is a deterministic member of the locked set. With an empty/UNKNOWN activity history the cold-start
  // tie-break now selects by offset (note count + per-item salt) instead of freezing on HOME[0], so it is not
  // necessarily HOME[0] — but it is always in-set and never crashes.
  assert.ok(HOME.includes(withLegacy.perBehavior.B.activity));
});

test('cold-start tie-break: lruPick rotates among the equally-oldest by offset (no more frozen set[0])', () => {
  const set = ['a', 'b', 'c'];
  // Empty history → every member ties at Infinity → offset selects the member, rotating with the note count.
  assert.equal(lruPick(set, [], 0), 'a');
  assert.equal(lruPick(set, [], 1), 'b');
  assert.equal(lruPick(set, [], 2), 'c');
  assert.equal(lruPick(set, [], 3), 'a', 'wraps modulo the tie size');
  assert.equal(lruPick(set, [], -1), 'c', 'negative offsets are guarded, not NaN');
  // When there IS a single genuinely-oldest member (all used, distinct ages), the tie is a singleton and the
  // offset is ignored — ordinary LRU wins.
  assert.equal(lruPick(set, ['a', 'b', 'c'], 99), lruPick(set, ['a', 'b', 'c'], 0), 'a singleton oldest ignores the offset');
  assert.equal(lruPick(set, ['a', 'b', 'c'], 99), 'c', 'c is the least-recently-used');
});

test('lruOrder: full LRU ordering, ties rotated by offset, always a permutation of the set', () => {
  const set = ['a', 'b', 'c', 'd'];
  const o0 = lruOrder(set, [], 0);
  assert.deepEqual([...o0].sort(), [...set].sort(), 'a permutation — nothing added or dropped');
  // Feeding recent uses pushes them to the BACK (least-recently-used first).
  const o = lruOrder(set, ['a', 'b'], 0); // a used most recently, then b; c,d never used
  assert.deepEqual(o.slice(2), ['b', 'a'], 'used items sink, most-recent last');
  assert.ok(o.slice(0, 2).includes('c') && o.slice(0, 2).includes('d'), 'unused float to the front');
});

test('reinforcer axis: rotates the survivor list across notes; a repeat only when genuinely oldest', () => {
  const survivors = ['DragonBallZ', 'Drawing', 'Playground', 'Recess', 'UNO'];
  const base = { behaviors: [], skills: [], approvedInterventions: ['DRA'], approvedMethods: ['Modeling'], location: 'home', homeActivities: HOME, schoolActivities: SCHOOL, reinforcerSurvivors: survivors };
  const named = new Set();
  const primaries = [];
  let history = [];
  for (let n = 0; n < 6; n++) {
    const r = preselect({ ...base, history, rotationOffset: n });
    r.reinforcers.forEach((x) => named.add(x)); // what THIS note names (top-3)
    primaries.push(r.reinforcers[0]);
    // record what this note named, newest-first, capped at the window=3 readGenerationHistory returns.
    history = [{ source: 'generation_context', perBehavior: {}, perSkill: {}, activities: [], reinforcers: r.reinforcers }, ...history].slice(0, 3);
  }
  // THE FIX: all five survivors get named across six notes — no single-reinforcer fixation (Dragon Ball Z was
  // in 5/8). And the primary is not a constant, so the note that leads with each reinforcer varies too.
  assert.equal(named.size, 5, `expected all 5 survivors named, got ${[...named].join(', ')}`);
  assert.ok(new Set(primaries).size >= 3, `primary should rotate, got ${primaries.join(', ')}`);
});

test('reinforcer axis: empty survivor list is safe (no crash, empty axis)', () => {
  const r = preselect({ behaviors: [], skills: [], approvedInterventions: ['DRA'], approvedMethods: ['Modeling'], location: 'home', homeActivities: HOME, schoolActivities: SCHOOL, history: [] });
  assert.deepEqual(r.reinforcers, []);
  assert.deepEqual(r.reinforcersOrder, []);
});

test('lruPick guarantees: empty set → undefined; singleton → itself; result always ∈ set', () => {
  assert.equal(lruPick([], ['x']), undefined);
  assert.equal(lruPick(['only'], ['only', 'only']), 'only');
  const set = ['a', 'b', 'c'];
  assert.ok(set.includes(lruPick(set, ['b', 'a', 'GARBAGE'])));
  assert.equal(lruPick(set, ['a', 'b']), 'c', 'the never-used member wins');
});

test('MARLON REQUIRED: the FIXED ASSIGNMENTS block handed to GPT contains ONLY approved content', () => {
  // A client whose plan would previously have blocked a note: approved is [DRA, Redirection], methods
  // [Modeling]. The block must name only those — never Behavior Momentum, DTT, or an off-list function.
  const approvedInterventions = ['DRA', 'Redirection'];
  const approvedMethods = ['Modeling'];
  const HOMEA = ['puzzle activity', 'coloring activity'];
  const behaviors = [
    { name: 'Throwing Objects', allowedFunctions: ['escape', 'tangible'], topographies: ['propelling objects'] },
    { name: 'Fidgeting', allowedFunctions: ['automatic'], topographies: ['tapping the table'] },
  ];
  const skills = [{ name: 'Break Request' }];
  const result = preselect({
    behaviors, skills, approvedInterventions, approvedMethods,
    location: 'home', homeActivities: HOMEA, schoolActivities: [], complianceLevel: 'typical',
    history: [{ source: 'generation_context', perBehavior: { 'Throwing Objects': { function: 'escape', interventionName: 'DRA' } }, perSkill: {}, activities: [] }],
  });
  const block = buildFixedAssignmentsBlock(result);

  // Every named intervention / method / function / activity in the assignments is drawn from a locked set.
  for (const a of Object.values(result.perBehavior)) {
    if (a.function) assert.ok(['escape', 'attention', 'tangible', 'automatic'].includes(a.function));
    assert.ok(approvedInterventions.includes(a.interventionName), `intervention ${a.interventionName} ∈ approved`);
    if (a.activity) assert.ok(HOMEA.includes(a.activity));
  }
  for (const a of Object.values(result.perSkill)) {
    if (a.method) assert.ok(approvedMethods.includes(a.method), 'method ∈ approved');
  }
  // The rendered block never contains an unapproved value.
  assert.ok(block.includes('Throwing Objects') && block.includes('FIXED ASSIGNMENTS'));
  assert.ok(!/Behavior Momentum|DTT|\bDRO\b|\bNET\b/.test(block), 'no unapproved intervention/method leaks into the block');
});

test('fit map only narrows: a function whose fitting interventions are all unapproved falls back to approved', () => {
  // automatic fits [NCR, DRO, DRI, Environmental Modification]; approved has none of them → fall back to the
  // approved set (still authorized), never expand.
  const r = preselect({
    behaviors: [{ name: 'Fidgeting', allowedFunctions: ['automatic'], topographies: ['tapping'] }],
    skills: [], approvedInterventions: ['DRA', 'Redirection'], approvedMethods: ['Modeling'],
    location: 'home', homeActivities: HOME, schoolActivities: SCHOOL, history: [],
  });
  assert.ok(['DRA', 'Redirection'].includes(r.perBehavior.Fidgeting.interventionName), 'fell back to the approved set');
});
