// Regression battery for the fieldwork_sessions soft-delete filter (see lib/softDelete.ts + lib/prisma.ts).
// Run with: `npm test` (Node's built-in runner; no deps).
//
// withNotDeleted is the piece that silently protects SIGNED-MONTH totals: recalculateMonth reads
// fieldwork_sessions via findMany, and the ONLY thing excluding soft-deleted rows from that recomputation
// is this filter (injected by the lib/prisma extension). If it ever stops adding `deleted_at: null`,
// deleted sessions re-enter the totals and corrupt a signed BACB record. These tests fail loudly if so.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withNotDeleted } from './softDelete.ts'

test('undefined where -> filters to deleted_at: null', () => {
  assert.deepEqual(withNotDeleted(undefined), { deleted_at: null })
})

test('null where -> filters to deleted_at: null', () => {
  assert.deepEqual(withNotDeleted(null), { deleted_at: null })
})

test('empty where -> filters to deleted_at: null', () => {
  assert.deepEqual(withNotDeleted({}), { deleted_at: null })
})

test('existing conditions are preserved, deleted_at: null is added (the recalculateMonth case)', () => {
  // recalculateMonth queries by user_id + month_year; the filter must NOT drop those.
  const out = withNotDeleted({ user_id: 'u1', month_year: '2026-08' })
  assert.deepEqual(out, { user_id: 'u1', month_year: '2026-08', deleted_at: null })
})

test('an explicit deleted_at is respected (maintenance/restore can target deleted rows)', () => {
  const targetingDeleted = { id: 'x', deleted_at: { not: null } }
  assert.deepEqual(withNotDeleted(targetingDeleted), targetingDeleted, 'must not overwrite an explicit deleted_at')
  const targetingOne = { deleted_at: '2026-08-05T00:00:00Z' }
  assert.deepEqual(withNotDeleted(targetingOne), targetingOne)
})

test('does not mutate the caller-supplied where object', () => {
  const input = { user_id: 'u1' }
  const out = withNotDeleted(input)
  assert.equal(input.deleted_at, undefined, 'original object must be untouched')
  assert.equal(out.deleted_at, null)
})
