// THE PRESELECTION INVARIANT (Commit 4). Run: `npm test`.
//
// Marlon's core property, tested BEFORE any rotation behaviour: LRU may REORDER only WITHIN a locked set; it
// can NEVER expand it. For arbitrary history and arbitrary approved sets, every preselected value is a member
// of its locked set. This is a property of the SELECTOR (code), never an instruction to GPT — which is what
// makes the class-A regenerations (unapproved function / intervention / method) structurally impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  preselect, lruPick, buildFixedAssignmentsBlock, FUNCTION_ANTECEDENTS, FUNCTION_INTERVENTIONS,
} from './preselect.ts';

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
      // intervention ALWAYS ∈ the client's approved interventions (fit only narrows within it).
      assert.ok(approvedInterventions.includes(a.interventionName), `intervention ${a.interventionName} ∈ approved`);
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
  const r = preselect({ behaviors, skills: [], approvedInterventions: ['DRA'], approvedMethods: ['Modeling'], location: 'home', homeActivities: HOME, schoolActivities: SCHOOL, history: legacy });
  // With no KNOWN activity usage, LRU picks the first of the set deterministically — never crashes, never
  // treats the legacy note as evidence.
  assert.equal(r.perBehavior.B.activity, HOME[0]);
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
