// Regression battery for the fieldwork_sessions soft-delete filter (see lib/softDelete.ts + lib/prisma.ts).
// Run with: `npm test` (Node's built-in runner; no deps).
//
// withNotDeleted is the piece that silently protects SIGNED-MONTH totals: recalculateMonth reads
// fieldwork_sessions via findMany, and the ONLY thing excluding soft-deleted rows from that recomputation
// is this filter (injected by the lib/prisma extension). If it ever stops adding `deleted_at: null`,
// deleted sessions re-enter the totals and corrupt a signed BACB record. These tests fail loudly if so.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withNotDeleted, prepareUniqueSelect, finalizeUniqueRow } from './softDelete.ts'

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

// ── findUnique support (clients — narrow-select reads). The leak the fieldwork post-filter does NOT cover. ──

test('prepareUniqueSelect: narrow select without deleted_at -> force-includes it (injected)', () => {
  const { args, injected } = prepareUniqueSelect({ where: { id: 'c1' }, select: { clinical_profile: true } })
  assert.equal(injected, true)
  assert.deepEqual(args.select, { clinical_profile: true, deleted_at: true })
})

test('prepareUniqueSelect: no select (full row) -> untouched (deleted_at already present)', () => {
  const { args, injected } = prepareUniqueSelect({ where: { id: 'c1' } })
  assert.equal(injected, false)
  assert.equal(args.select, undefined)
})

test('prepareUniqueSelect: select already has deleted_at -> untouched', () => {
  const { args, injected } = prepareUniqueSelect({ where: { id: 'c1' }, select: { id: true, deleted_at: true } })
  assert.equal(injected, false)
  assert.deepEqual(args.select, { id: true, deleted_at: true })
})

test('THE LEAK: findUnique with a narrow select must NOT return an archived client', () => {
  // Simulate findUnique({ where:{id}, select:{clinical_profile:true} }) on an ARCHIVED client.
  const { args, injected } = prepareUniqueSelect({ where: { id: 'c1' }, select: { clinical_profile: true } })
  // The DB, with deleted_at force-included, returns the archived row:
  const dbRow = { clinical_profile: { name: 'x' }, deleted_at: '2026-08-31T00:00:00Z' }
  assert.equal(finalizeUniqueRow(dbRow, injected), null, 'archived client must be filtered to null')
})

test('active client with a narrow select -> returned, injected deleted_at stripped back off', () => {
  const { args, injected } = prepareUniqueSelect({ where: { id: 'c1' }, select: { clinical_profile: true } })
  const dbRow = { clinical_profile: { name: 'x' }, deleted_at: null }
  assert.deepEqual(finalizeUniqueRow(dbRow, injected), { clinical_profile: { name: 'x' } }, 'shape unchanged for the caller')
})

test('finalizeUniqueRow OrThrow: archived row throws', () => {
  assert.throws(() => finalizeUniqueRow({ id: 'c1', deleted_at: '2026-08-31T00:00:00Z' }, false, { throwOnDeleted: true }))
})

test('finalizeUniqueRow: null row (not found) passes through as null', () => {
  assert.equal(finalizeUniqueRow(null, false), null)
  assert.equal(finalizeUniqueRow(null, true), null)
})
