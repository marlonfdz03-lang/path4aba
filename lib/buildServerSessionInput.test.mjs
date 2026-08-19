// Regression for the ONE server-side SessionInput builder (see buildServerSessionInput.ts). Run: `npm test`.
//
// The point of consolidation: every entry point POSTs a slim payload and the server derives the
// constraint sets (allowedFunctions, matrixFunctions, approvedInterventions) from the DB profile — so
// the function gate applies on ALL paths, including the extension, which sent NO allowedFunctions before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServerSessionInput, isSlimNoteRequest } from './buildServerSessionInput.ts';

// A minimal profile shaped like a real clinical_profile (Felix-like: Fidgeting automatic-only, Throwing
// approved for automatic+escape, an ABA-Matrix catalog without Automatic).
const PROFILE = {
  diagnosis: ['Autism Spectrum Disorder'],
  gender: 'male',
  pronouns: 'he/him/his',
  caregivers: ['Grandmother'],
  interventions: [{ name: 'DRA' }, { name: 'FCT' }],
  reinforcers: ['fidget tools', 'bean bags'],
  homeActivities: ['puzzles', 'coloring'],
  maladaptiveBehaviors: [
    { name: 'Fidgeting', topographies: ['tapping'], functions: ['automatic'] },
    { name: 'Throwing Objects', topographies: ['propelling objects'], functions: ['automatic', 'escape'] },
  ],
  replacementBehaviors: [{ name: 'Break Request' }],
  skillAcquisition: [],
  observedCatalog: { aba_matrix: { current: { functions: ['Attention', 'Escape', 'Tangibles'] } } },
};

const SLIM = {
  clientId: 'felix-1',
  date: '2026-08-05',
  location: 'home',
  present: ['Grandmother'],
  selectedBehaviors: ['Fidgeting', 'Throwing Objects'],
  selectedSkills: ['Break Request'],
  medicationChange: true,
};

// (2 in the plan) shape detection for dual-accept.
test('isSlimNoteRequest: slim has selectedBehaviors, fat has behaviorsObserved', () => {
  assert.equal(isSlimNoteRequest(SLIM), true);
  assert.equal(isSlimNoteRequest({ behaviorsObserved: [], clientId: 'x' }), false);
  assert.equal(isSlimNoteRequest(null), false);
});

// THE DRIFT-CLOSING TEST: the extension used to send NO allowedFunctions, so its notes ran no function
// gate. Built server-side from the same slim payload, every behavior now carries its approved set.
test('drift closed: server-built SessionInput carries allowedFunctions for the function gate (extension had none)', () => {
  const input = buildServerSessionInput(SLIM, PROFILE);
  const throwing = input.behaviorsObserved.find((b) => b.name === 'Throwing Objects');
  assert.deepEqual(throwing.allowedFunctions, ['automatic', 'escape'], 'allowedFunctions derived from the assessment');
  const fidget = input.behaviorsObserved.find((b) => b.name === 'Fidgeting');
  assert.deepEqual(fidget.allowedFunctions, ['automatic']);
  // Every behavior has a non-undefined allowedFunctions -> the gate fires on all of them.
  assert.ok(input.behaviorsObserved.every((b) => Array.isArray(b.allowedFunctions)));
});

// (1 in the plan) all 9 fields derived — matrixFunctions from the captured catalog, diagnosis real.
test('server builder derives matrixFunctions + real diagnosis + top-level pronouns from the DB profile', () => {
  const input = buildServerSessionInput(SLIM, PROFILE);
  assert.deepEqual(input.matrixFunctions, ['Attention', 'Escape', 'Tangibles']);
  assert.deepEqual(input.clientProfile.diagnosis, ['Autism Spectrum Disorder'], 'real diagnosis (app path used to send [])');
  assert.equal(input.gender, 'male', 'gender/pronouns are TOP-LEVEL where generateSmartNote reads them');
  assert.equal(input.pronouns, 'he/him/his');
  assert.equal(input.clientProfile.approvedInterventions.join(','), 'DRA,FCT');
});

// PER-BEHAVIOR matrix: each behavior carries its OWN captured dropdown; a behavior with no per-behavior
// entry falls back to the global union (backward compat — pre-per-behavior captures narrow nothing new).
test('per-behavior matrixFunctions: each behavior gets its own dropdown, else the union', () => {
  const profile = {
    ...PROFILE,
    observedCatalog: { aba_matrix: { current: {
      functions: ['Attention', 'Escape', 'Tangibles'], // the union (legacy field, kept)
      functionsByBehavior: { Fidgeting: ['Automatic Reinforcement', 'Escape'] }, // Fidgeting's OWN dropdown
    } } },
  };
  const input = buildServerSessionInput(SLIM, profile);
  const fidget = input.behaviorsObserved.find((b) => b.name === 'Fidgeting');
  const throwing = input.behaviorsObserved.find((b) => b.name === 'Throwing Objects');
  assert.deepEqual(fidget.matrixFunctions, ['Automatic Reinforcement', 'Escape'], 'Fidgeting uses its own dropdown');
  assert.deepEqual(throwing.matrixFunctions, ['Attention', 'Escape', 'Tangibles'], 'no per-behavior entry -> union fallback');
  // Top-level union stays for anything global.
  assert.deepEqual(input.matrixFunctions, ['Attention', 'Escape', 'Tangibles']);
});
test('backward compat: catalog with only the union -> every behavior narrows to the union (no regression)', () => {
  const input = buildServerSessionInput(SLIM, PROFILE); // PROFILE has only `functions`, no functionsByBehavior
  for (const b of input.behaviorsObserved) {
    assert.deepEqual(b.matrixFunctions, ['Attention', 'Escape', 'Tangibles'], `${b.name} falls back to the union`);
  }
});

// no catalog captured -> matrixFunctions undefined (assessment-only fallback, no regression).
test('no ABA-Matrix catalog -> matrixFunctions undefined (fallback, never narrows)', () => {
  const { observedCatalog, ...noCatalog } = PROFILE;
  const input = buildServerSessionInput(SLIM, noCatalog);
  assert.equal(input.matrixFunctions, undefined);
  assert.deepEqual(input.behaviorsObserved.find((b) => b.name === 'Fidgeting').allowedFunctions, ['automatic']);
});

// Date key: the real extension/app/website slim payload sends the session date under `date`. The 70
// pre-existing tests never exercised the actual extension payload's date key — this locks it in so a
// "sessionInfo.date is required" regression (date not reaching the builder) is caught here, not live.
test('slim payload `date` maps to SessionInput.sessionInfo.date (real extension body)', () => {
  const extBody = {
    clientId: 'x', date: '2026-08-03', location: 'home', present: ['G'],
    selectedBehaviors: ['Tantrums'], selectedSkills: [], compliance: 'typical',
    medicationChange: false, envChange: false, envChangeDesc: '',
    missedHours: false, missedCount: '', missedReason: '', nextAppt: '',
  };
  assert.equal(isSlimNoteRequest(extBody), true, 'the real extension body is detected as slim');
  const input = buildServerSessionInput(extBody, { maladaptiveBehaviors: [] });
  assert.equal(input.sessionInfo.date, '2026-08-03', '`date` -> sessionInfo.date');
});
test('slim payload with empty date -> sessionInfo.date empty (the route then 400s legibly)', () => {
  const input = buildServerSessionInput({ clientId: 'x', date: '', location: 'home', selectedBehaviors: ['T'] }, {});
  assert.equal(input.sessionInfo.date, '');
});

// (med decision) HIPAA-conservative: a fixed statement, never the free-text med description.
test('medication: fixed non-identifying statement, no free-text detail in the prompt', () => {
  const input = buildServerSessionInput(SLIM, PROFILE);
  assert.match(input.clinicalEvents, /A medication change was reported this session\./);
  // The extension's free-text `Medication change: <detail>` form must never appear.
  assert.doesNotMatch(input.clinicalEvents, /Medication change:/);
  // And with no med change, no medication sentence at all.
  const noMed = buildServerSessionInput({ ...SLIM, medicationChange: false }, PROFILE);
  assert.doesNotMatch(noMed.clinicalEvents, /medication/i);
});

// (Bug 1) Read-time reinforcer split: a stored profile persisted before the ingest-time " or " split
// still holds "tablet or phone" as one element. The builder must re-split it so the note names a single
// resolved reinforcer and never renders "(tablet or phone)". Reuses splitReinforcerValue; idempotent.
test('reinforcer read-split: stored "tablet or phone" resolves to discrete items, no "or"', () => {
  const input = buildServerSessionInput(SLIM, { ...PROFILE, reinforcers: ['tablet or phone', 'Pokémon cards'] });
  const items = input.reinforcersUsed.map((r) => r.item);
  // "tablet or phone" is split; the note-facing items carry no unresolved alternative.
  assert.ok(items.includes('tablet'), `expected "tablet" among ${JSON.stringify(items)}`);
  assert.ok(!items.some((i) => /\bor\b/i.test(i)), `no item may contain "or": ${JSON.stringify(items)}`);
});
test('reinforcer read-split: idempotent — already-split array passes through unchanged', () => {
  const input = buildServerSessionInput(SLIM, { ...PROFILE, reinforcers: ['tablet', 'phone', 'Pokémon cards'] });
  assert.deepEqual(input.reinforcersUsed.map((r) => r.item), ['tablet', 'phone', 'Pokémon cards']);
});
test('reinforcer read-split: a single item with no delimiter stays single (no over-split of compounds)', () => {
  const input = buildServerSessionInput(SLIM, { ...PROFILE, reinforcers: ['kinetic sand and bin'] });
  assert.deepEqual(input.reinforcersUsed.map((r) => r.item), ['kinetic sand and bin']);
});

// ── CAREGIVER: the RBT's selection is the identity that prints ────────────────────────────────
// A client normally has SEVERAL caregivers on file (mother, father, grandmother). That roster is the
// set of OPTIONS; the RBT marks who was present THIS session. The roster used to win, so the note
// named someone the RBT did not select and no form change could fix it.

const MULTI = { ...PROFILE, caregivers: ['Margot Villar (mother)', 'Gretel Rodriguez', 'Ms. Ana'] };
const withPresent = (present, profile = MULTI) =>
  buildServerSessionInput({ ...SLIM, present }, profile, null).sessionInfo;

test('caregiver: the note names the caregiver the RBT marked, not the roster', () => {
  const info = withPresent(['Margot Villar']);
  assert.equal(info.caregiverName, 'Margot Villar (mother)',
    'the selected caregiver prints, annotated with the relationship the roster records');
  assert.ok(!/Gretel Rodriguez/.test(info.caregiverName),
    'a roster caregiver the RBT did NOT select must never reach the note');
  assert.ok(!/Ms\. Ana/.test(info.caregiverName));
});

test('caregiver: an unmatched selection prints exactly as entered', () => {
  // "RBT"/"CLIENT"/a substitute teacher are real entries in whoWasPresent and are not caregivers.
  assert.equal(withPresent(['Ms. Fabregas']).caregiverName, 'Ms. Fabregas');
  assert.equal(withPresent(['RBT']).caregiverName, 'RBT');
});

test('caregiver: the selection is never substituted, added to, or reordered', () => {
  assert.equal(withPresent(['Gretel Rodriguez', 'Margot Villar']).caregiverName,
    'Gretel Rodriguez and Margot Villar (mother)', 'selection order is preserved; nothing is added');
  // An empty roster must not change the behaviour — the selection still prints.
  assert.equal(withPresent(['Margot Villar'], { ...PROFILE, caregivers: [] }).caregiverName, 'Margot Villar');
  // A selection already carrying the relationship keeps its own richer form.
  assert.equal(withPresent(['Margot Villar (mother)'], { ...PROFILE, caregivers: ['Margot Villar'] }).caregiverName,
    'Margot Villar (mother)');
});

test('caregiver: no selection falls back without inventing a caregiver', () => {
  const info = withPresent([]);
  assert.equal(info.caregiverName, '', 'an empty selection must not fall back to the roster');
  assert.equal(info.caregiver, '');
});

// ── BEHAVIOR SCOPE: the note documents ONLY what the RBT marked ───────────────────────────────
// The prompt used to demand a fixed "EXACTLY 5 ABCs" while the form allowed generating with one
// marked behavior, and the builder handed over the client's ENTIRE treatment-plan behavior list.
// The model had to fill the gap from that list, putting behaviors that did not occur into a
// billable note. The ABC count now equals the marked count, and the plan's other behaviors are
// not sent at all.

test('behavior scope: only the marked behaviors reach the note', () => {
  const input = buildServerSessionInput({ ...SLIM, selectedBehaviors: ['Fidgeting'] }, PROFILE, null);
  assert.equal(input.behaviorsObserved.length, 1, 'one marked behavior -> one documented behavior');
  assert.equal(input.behaviorsObserved[0].name, 'Fidgeting');
  assert.deepEqual(input.clientProfile.activePrograms.maladaptive, ['Fidgeting'],
    'the plan\'s OTHER behaviors must not be sent as fill material');
  assert.ok(!JSON.stringify(input).includes('Throwing Objects'),
    'an unmarked plan behavior must not appear anywhere in the note input');
});

test('behavior scope: marking several sends exactly those, in order', () => {
  const marked = ['Throwing Objects', 'Fidgeting'];
  const input = buildServerSessionInput({ ...SLIM, selectedBehaviors: marked }, PROFILE, null);
  assert.deepEqual(input.behaviorsObserved.map((b) => b.name), marked);
  assert.deepEqual(input.clientProfile.activePrograms.maladaptive, marked);
});

// ── SKILLS: the RBT marks WHICH programs, not how each went ───────────────────────────────────
test('skills: no per-skill verdict or prompt level is asserted', () => {
  const input = buildServerSessionInput({ ...SLIM, selectedSkills: ['Break Request'] }, PROFILE, null);
  const skill = input.replacementSkillsAddressed[0];
  assert.equal(skill.name, 'Break Request');
  assert.equal(skill.successful, undefined, 'the system must not declare a skill successful');
  assert.equal(skill.promptLevel, undefined, 'the RBT is not asked for a prompt level');
  assert.equal(skill.clientResponse, undefined, 'the RBT is not asked for a per-skill response');
});

test('compliance: the RBT\'s selection reaches the note for all three levels', () => {
  // "typical" used to be dropped, leaving the prose with no real signal to follow.
  for (const level of ['typical', 'below_typical', 'poor']) {
    assert.equal(buildServerSessionInput({ ...SLIM, compliance: level }, PROFILE, null).complianceLevel, level);
  }
  assert.equal(buildServerSessionInput({ ...SLIM, compliance: '' }, PROFILE, null).complianceLevel, undefined);
});

// ── LOCATION: the typed "Other" place reaches the note ────────────────────────────────────────
test('location: an "Other" location uses the text the RBT typed', () => {
  const input = buildServerSessionInput(
    { ...SLIM, location: 'other', otherLocation: "grandmother's house" }, PROFILE, null);
  assert.equal(input.sessionInfo.location, "grandmother's house",
    'the note must name the place, not the literal selector value "other"');
  assert.equal(input.clientProfile.setting, "grandmother's house");
});

test('location: "Other" with nothing typed falls back without printing "other"', () => {
  const input = buildServerSessionInput({ ...SLIM, location: 'other', otherLocation: '  ' }, PROFILE, null);
  assert.equal(input.sessionInfo.location, 'community setting');
});

test('location: the standard locations are unchanged', () => {
  for (const loc of ['home', 'school', 'clinic']) {
    assert.equal(buildServerSessionInput({ ...SLIM, location: loc }, PROFILE, null).sessionInfo.location, loc);
  }
});
