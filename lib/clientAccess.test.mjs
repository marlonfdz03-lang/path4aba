// The cross-tenant ownership rule (lib/clientAccess.ts). Run: `npm test`.
// This is the single rule every one of the 12 hardened clinical routes enforces, so its edge cases are
// tested once here rather than per-route. ownsFn is injected — no DB needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { principalCanAccessClient } from './clientAccess.ts';

const owns = async () => true;
const notOwns = async () => false;
const throws = async () => { throw new Error('db down'); };

test('owner passes', async () => {
  assert.equal(await principalCanAccessClient({ id: 'u1', role: 'rbt' }, 'c1', owns), true);
});

test('non-owner is denied (→ 403 at the route)', async () => {
  assert.equal(await principalCanAccessClient({ id: 'u2', role: 'rbt' }, 'c1', notOwns), false);
});

test('admin passes WITHOUT consulting ownership — even if the lookup would throw', async () => {
  assert.equal(await principalCanAccessClient({ id: 'admin1', role: 'admin' }, 'c1', throws), true);
});

test('no principal id → denied', async () => {
  assert.equal(await principalCanAccessClient({ id: null, role: 'rbt' }, 'c1', owns), false);
  assert.equal(await principalCanAccessClient(null, 'c1', owns), false);
  assert.equal(await principalCanAccessClient(undefined, 'c1', owns), false);
});

test('no clientId → denied for EVERYONE, admin included (a nobody-owned / null-client_id row)', async () => {
  assert.equal(await principalCanAccessClient({ id: 'u1', role: 'rbt' }, null, owns), false);
  assert.equal(await principalCanAccessClient({ id: 'u1', role: 'rbt' }, undefined, owns), false);
  assert.equal(await principalCanAccessClient({ id: 'u1', role: 'rbt' }, '', owns), false);
  assert.equal(await principalCanAccessClient({ id: 'admin1', role: 'admin' }, null, owns), false);
});

test('fail closed: a throwing ownership lookup denies, never allows', async () => {
  assert.equal(await principalCanAccessClient({ id: 'u1', role: 'rbt' }, 'c1', throws), false);
});
