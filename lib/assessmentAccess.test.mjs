// Assessment Builder access rule (BCBA-only). Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAssessmentBuilderRole } from './assessmentAccess.ts';

test('BCBA and admin reach the Builder; RBT (and everyone else) cannot', () => {
  // the real roles in the system: rbt (7), bcba (1), admin (1)
  assert.equal(isAssessmentBuilderRole('bcba'), true);
  assert.equal(isAssessmentBuilderRole('bcaba'), true);   // assistant-analyst variant, treated as BCBA area
  assert.equal(isAssessmentBuilderRole('admin'), true);
  assert.equal(isAssessmentBuilderRole('rbt'), false);    // RBTs have NO access
  assert.equal(isAssessmentBuilderRole('student'), false);
  assert.equal(isAssessmentBuilderRole('user'), false);
});

test('case-insensitive and null-safe', () => {
  assert.equal(isAssessmentBuilderRole('BCBA'), true);
  assert.equal(isAssessmentBuilderRole('Admin'), true);
  assert.equal(isAssessmentBuilderRole('RBT'), false);
  assert.equal(isAssessmentBuilderRole(null), false);
  assert.equal(isAssessmentBuilderRole(undefined), false);
  assert.equal(isAssessmentBuilderRole(''), false);
});
