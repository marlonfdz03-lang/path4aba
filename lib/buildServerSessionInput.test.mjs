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
