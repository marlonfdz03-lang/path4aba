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
    nextAppt: '',
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

// (Bug 1) Read-time reinforcer split — the guarantee rides on this again now that reinforcer data flows.
// A stored profile persisted before the ingest-time " or " split still holds "tablet or phone" as one
// element; the builder re-splits it so the note names a single item and never renders the unresolved
// "(tablet or phone)". Idempotent (an already-split value is a no-op). splitReinforcerValue is also
// tested directly in reinforcers.test.mjs.
test('reinforcer read-split: a stored "tablet or phone" resolves to single items, never the alternative', () => {
  const input = buildServerSessionInput(SLIM, { ...PROFILE, reinforcers: ['tablet or phone', 'Pokémon cards'] });
  const items = input.reinforcersUsed.map((r) => r.item);
  assert.ok(items.includes('tablet') && items.includes('phone'), 'the alternative is split into single items');
  assert.ok(!JSON.stringify(input).includes('tablet or phone'), 'the unresolved "tablet or phone" never reaches the note');
  assert.ok(items.includes('Pokémon cards'), 'a normal profile reinforcer is still named');
});

// ── PROHIBITED INTERVENTIONS: read from the assessment, constant only as fallback (C3) ────────
test('prohibited interventions: the profile\'s own list wins; the constant is only the fallback', () => {
  // Fallback: a profile with no prohibited list still gets the always-banned set.
  const fallback = buildServerSessionInput(SLIM, PROFILE, null).clientProfile.prohibitedInterventions;
  assert.ok(fallback.includes('Restraint') && fallback.includes('Punishment'), 'the always-banned constant applies');
  // Assessment-supplied: the profile's own list is used (strings or { name } objects).
  const withList = buildServerSessionInput(SLIM,
    { ...PROFILE, prohibitedInterventions: ['Seclusion', { name: 'Chemical Restraint' }] }, null,
  ).clientProfile.prohibitedInterventions;
  assert.deepEqual(withList, ['Seclusion', 'Chemical Restraint'], 'the assessment list wins, mapped to names');
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

// ── SKILLS: name is the locked source; promptLevel/clientResponse are authorized generation ────
test('skills: prompt level and response are generative (empty), success is NOT hardcoded', () => {
  const input = buildServerSessionInput({ ...SLIM, selectedSkills: ['Break Request'] }, PROFILE, null);
  const skill = input.replacementSkillsAddressed[0];
  assert.equal(skill.name, 'Break Request');
  // successful stays REMOVED as a hardcoded constant — a compliance-controlled outcome arrives later.
  assert.equal(skill.successful, undefined, 'success must not be hardcoded true');
  // Sent empty so the prompt GENERATES the prompt level / response (authorized generation), guided by
  // the session's compliance level — not suppressed.
  assert.equal(skill.promptLevel, '', 'prompt level is an empty generative placeholder, not suppressed');
  assert.equal(skill.clientResponse, '', 'client response is an empty generative placeholder, not suppressed');
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

// ── REINFORCERS AND ACTIVITIES: locked assessment sources, restored ───────────────────────────
// These are assessment-derived (a locked source), so the note MAY name them. No `preferred` (the
// profile does not record preference) and no hardcoded `deliveredWhen` (the contingency is the one the
// ABC describes, left blank for the prompt to supply).
test('reinforcers and activities are named from the assessment (locked source)', () => {
  const input = buildServerSessionInput(SLIM, PROFILE, null);
  // Reinforcer items come from the profile (re-split); no preference, no hardcoded contingency.
  assert.deepEqual(input.reinforcersUsed.map((r) => r.item), ['fidget tools', 'bean bags']);
  assert.ok(input.reinforcersUsed.every((r) => r.type === 'non-edible' && r.deliveredWhen === ''),
    'no hardcoded "contingent on task engagement"');
  // Activities: the assessment's split home list, merged with the curated master list.
  const activityNames = input.activitiesUsed.map((a) => a.name);
  assert.ok(activityNames.includes('puzzles') && activityNames.includes('coloring'),
    'the assessment activities are present');
  assert.ok(input.activitiesUsed.every((a) => !('preferred' in a)), 'no preference is asserted');
  // The profile names also reach clientProfile.reinforcers for the prompt.
  assert.equal(input.clientProfile.reinforcers.tangibles, 'fidget tools, bean bags');
});

test('who was present reaches the note alongside the restored reinforcer names', () => {
  const input = buildServerSessionInput({ ...SLIM, present: ['Grandmother'] }, PROFILE, null);
  assert.equal(input.clientProfile.reinforcers.people, 'Grandmother', 'the RBT\'s marked-present selection');
  assert.equal(input.clientProfile.reinforcers.tangibles, 'fidget tools, bean bags', 'locked-source names restored');
  assert.equal(input.clientProfile.reinforcers.social, '', 'social literal removed — the prompt generates praise itself');
});

// ── EDIBLE POLICY REVERSED (Marlon's ruling) ──────────────────────────────────────────────────
// Edibles are NO LONGER filtered at selection. If a clinician put food on the plan, the note must document
// what was actually delivered — substituting a generic "preferred toy" for a sweet the RBT handed over is a
// false record, worse than documenting a not-recommended practice. The community-outing and person firewalls
// still apply (neither is a deliverable in-session reinforcer). The type tag is honestly derived, so edibles
// are labeled 'edible' — no more false 'non-edible' tag.
test('MARLON: edibles reach the note now (not filtered); type tag labels them edible', () => {
  const profile = { ...PROFILE, reinforcers: ['strawberries', 'cookies', 'chocolate', 'fidget toy', 'poker chip', 'tablet'] };
  const input = buildServerSessionInput(SLIM, profile, null);
  const items = input.reinforcersUsed.map((r) => r.item);
  // reinforcersUsed is the top-3 (fallback order); the edibles lead and are present, not stripped.
  assert.deepEqual(items, ['strawberries', 'cookies', 'chocolate'], 'edibles reach reinforcersUsed');
  // the FULL survivor list (what the rotation axis rotates over) keeps every item including edibles + toys.
  for (const r of ['strawberries', 'cookies', 'chocolate', 'fidget toy', 'poker chip', 'tablet'])
    assert.ok(input.reinforcerSurvivors.includes(r), `${r} kept in survivors`);
  // tangibles(5) carries edibles too.
  assert.ok(input.clientProfile.reinforcers.tangibles.includes('strawberries'), 'edibles reach tangibles');
  // honest type tag: edible items tagged 'edible', non-edible items 'non-edible'.
  const type = Object.fromEntries(input.reinforcersUsed.map((r) => [r.item, r.type]));
  assert.equal(type['strawberries'], 'edible');
  assert.equal(type['cookies'], 'edible');
});

test('all-edible profile → edibles are named (policy reversed; not emptied)', () => {
  const profile = { ...PROFILE, reinforcers: ['cookies', 'candy', 'ice cream', 'juice'] };
  const input = buildServerSessionInput(SLIM, profile, null);
  assert.deepEqual(input.reinforcersUsed.map((r) => r.item), ['cookies', 'candy', 'ice cream'], 'edibles now named (top-3)');
  assert.ok(input.reinforcersUsed.every((r) => r.type === 'edible'), 'all correctly typed edible');
  assert.ok(input.clientProfile.reinforcers.tangibles.includes('cookies'), 'edibles reach tangibles');
});
