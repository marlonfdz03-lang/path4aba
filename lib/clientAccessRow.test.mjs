// Batch 3 (maladaptive-data, replacement-data): the id-based mutations carry a raw row id, not a clientId,
// so ownership is enforced by principalCanAccessRow — resolve the row's owning client, then apply the
// shared rule. This asserts every deny path (missing row, NULL client_id, resolver throws, non-owner) and
// the owner-passes path. The bulk-POST "own every clientId in the batch, or reject the whole request"
// logic is a plain array check over principalCanAccessClient (tested in clientAccess.test.mjs); its
// all-or-nothing semantics are modeled here too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { principalCanAccessRow, principalCanAccessClient } from './clientAccess.ts';

const owns = async (_u, c) => c === 'c-owned';        // caller owns only c-owned
const rbt = { id: 'rbt1', role: 'rbt' };
const admin = { id: 'a1', role: 'admin' };

const rowWith = (client_id) => async () => ({ client_id });
const missingRow = async () => null;
const throwingResolver = async () => { throw new Error('db down'); };

test('id-mutation: owner of the resolved client passes', async () => {
  assert.equal(await principalCanAccessRow(rbt, rowWith('c-owned'), 'id1', owns), true);
});

test('id-mutation: non-owner of the resolved client → denied', async () => {
  assert.equal(await principalCanAccessRow(rbt, rowWith('c-other'), 'id1', owns), false);
});

test('id-mutation: NULL client_id (nobody-owned row) → denied, even for admin', async () => {
  assert.equal(await principalCanAccessRow(rbt, rowWith(null), 'id1', owns), false);
  assert.equal(await principalCanAccessRow(admin, rowWith(null), 'id1', owns), false);
});

test('id-mutation: missing row → denied (403, not 404 — route leaks nothing)', async () => {
  assert.equal(await principalCanAccessRow(rbt, missingRow, 'id1', owns), false);
});

test('id-mutation: a resolver that throws denies (fail closed)', async () => {
  assert.equal(await principalCanAccessRow(rbt, throwingResolver, 'id1', owns), false);
});

test('id-mutation: admin passes when the row resolves to a real client', async () => {
  assert.equal(await principalCanAccessRow(admin, rowWith('c-other'), 'id1', owns), true);
});

test('bulk batch: all-or-nothing — one non-owned client in the batch fails the whole request', async () => {
  const batch = ['c-owned', 'c-owned', 'c-other'];
  const results = await Promise.all(batch.map((c) => principalCanAccessClient(rbt, c, owns)));
  assert.equal(results.some((ok) => !ok), true); // → route returns 403 for the whole batch, no partial write
});

test('bulk batch: caller owns every client → batch passes', async () => {
  const batch = ['c-owned', 'c-owned'];
  const results = await Promise.all(batch.map((c) => principalCanAccessClient(rbt, c, owns)));
  assert.equal(results.every((ok) => ok), true);
});
