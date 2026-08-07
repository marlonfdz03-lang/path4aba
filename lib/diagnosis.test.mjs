// Diagnosis normalization (run: `npm test`). Deterministic FIREWALL backstop: only CONFIRMED diagnoses,
// no Z-codes, no suspected/rule-out/differential/provisional, deduped. Governs every client. Plus a
// source-check that the refresh route writes the clients.diagnosis COLUMN via diagnosisColumn (column-sync).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeDiagnosis, diagnosisColumn } from './diagnosis.ts';

const codes = (arr) => arr.flatMap((s) => (String(s).match(/[A-Z]\d{2}(?:\.\d+)?/g) || []).map((c) => c.toUpperCase()));

test('Felix case: F82 (suspected) and Z55.9 (Z-code) dropped → exactly F84.0, F90.2, F91.3', () => {
  const raw = [
    'Autism Spectrum Disorder, Level 1 (F84.0)',
    'Attention-Deficit/Hyperactivity Disorder, Combined Presentation (F90.2)',
    'Oppositional Defiant Disorder (F91.3)',
    'suspected Developmental Coordination Disorder (F82)',
    'Academic or Educational Problem (Z55.9)',
  ];
  assert.deepEqual(codes(normalizeDiagnosis(raw)).sort(), ['F84.0', 'F90.2', 'F91.3']);
});

test('Z-codes are ALWAYS excluded', () => {
  assert.deepEqual(normalizeDiagnosis(['Problem (Z55.9)', 'ASD (F84.0)']).length, 1);
  assert.equal(codes(normalizeDiagnosis(['Homelessness (Z59.0)'])).length, 0);
});

test('unconfirmed markers ALWAYS excluded (suspected / rule-out / r/o / differential / provisional / possible / probable)', () => {
  for (const marker of ['suspected', 'rule-out', 'rule out', 'r/o', 'differential', 'provisional', 'possible', 'probable', 'to rule out']) {
    assert.deepEqual(normalizeDiagnosis([`${marker} Bipolar Disorder (F31.9)`]), [], `"${marker}" must be excluded`);
  }
});

test('a CONFIRMED diagnosis with the same code is kept (marker match is on the string, not the code)', () => {
  assert.equal(codes(normalizeDiagnosis(['Autism Spectrum Disorder (F84.0)'])).length, 1);
});

test('dedupe by ICD code (case-insensitive), first occurrence kept', () => {
  const out = normalizeDiagnosis(['ASD (F84.0)', 'Autism Spectrum Disorder (f84.0)', 'ADHD (F90.2)']);
  assert.equal(out.length, 2);
  assert.equal(out[0], 'ASD (F84.0)');
});

test('dedupe by name when no code present', () => {
  assert.equal(normalizeDiagnosis(['Autism', 'autism', 'ADHD']).length, 2);
});

test('robust to OBJECT-shaped entries ({name, ICDCode|code|icd}) — schema wobble never breaks the firewall', () => {
  const out = normalizeDiagnosis([
    { name: 'Attention-Deficit/Hyperactivity Disorder, Combined Presentation', ICDCode: 'F90.2' },
    { name: 'Autism Spectrum Disorder, Level 1', code: 'F84.0' },
    { name: 'Developmental Coordination Disorder', icd: 'Z55.9' }, // Z-code still dropped from an object
  ]);
  assert.deepEqual(codes(out).sort(), ['F84.0', 'F90.2']);
  assert.equal(out[0], 'Attention-Deficit/Hyperactivity Disorder, Combined Presentation (F90.2)');
});

test('handles string / empty / non-array input', () => {
  assert.deepEqual(normalizeDiagnosis('ASD (F84.0)'), ['ASD (F84.0)']);
  assert.deepEqual(normalizeDiagnosis(null), []);
  assert.deepEqual(normalizeDiagnosis(undefined), []);
  assert.deepEqual(normalizeDiagnosis([]), []);
});

test('diagnosisColumn: normalized list joined; no Z-code / suspected can reach the column', () => {
  const col = diagnosisColumn(['ASD (F84.0)', 'suspected DCD (F82)', 'Problem (Z55.9)', 'ADHD (F90.2)']);
  assert.equal(col, 'ASD (F84.0), ADHD (F90.2)');
  assert.deepEqual(codes([col]).sort(), ['F84.0', 'F90.2']);
});

test('column-sync no-drift: column codes always equal normalized-json codes', () => {
  const raw = ['ASD (F84.0)', 'ADHD (F90.2)', 'Problem (Z55.9)'];
  const json = normalizeDiagnosis(raw);
  assert.deepEqual(codes([diagnosisColumn(json)]).sort(), codes(json).sort());
});

// SOURCE-CHECK: the refresh route must write the clients.diagnosis COLUMN via diagnosisColumn (column-sync).
// Guards against a future edit dropping the column write and letting it drift from the JSON again.
test('refresh route wires the diagnosis column-sync (diagnosisColumn in the clients.update)', () => {
  const src = readFileSync(new URL('../app/api/extract-assessment/route.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('diagnosisColumn'), 'route must import + call diagnosisColumn');
  assert.ok(/data:\s*{[\s\S]*diagnosis:\s*diagnosisColumn/.test(src), 'clients.update data must set diagnosis via diagnosisColumn');
});
