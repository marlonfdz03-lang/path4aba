// Batch 2 (extension + generate-note routes): these routes derive the principal from getExtensionAuth(),
// whose ExtensionUser shape is { id, role, email, data_tab_enabled } — NOT a NextAuth session. This asserts
// the SAME shared rule behaves correctly when handed that exact shape (owner passes, non-owner 403, admin
// passes), and encodes the "guard only when a clientId is present" contract those routes rely on.
// Route wiring itself (auth→own→fetch order in generate-note; clientId-scoped guard in extract-facts) is
// verified by code review + tsc — it needs a live server/DB, not a unit test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { principalCanAccessClient } from './clientAccess.ts';

// getExtensionAuth() returns this shape; routes project { id, role } from it.
const extUser = (id, role) => ({ id, role, email: `${id}@x`, data_tab_enabled: false });
const owns = async () => true;
const notOwns = async () => false;

test('extension owner passes with the ExtensionUser {id,role} shape', async () => {
  const u = extUser('rbt1', 'rbt');
  assert.equal(await principalCanAccessClient({ id: u.id, role: u.role }, 'c1', owns), true);
});

test('extension non-owner is denied (→ 403)', async () => {
  const u = extUser('rbt2', 'rbt');
  assert.equal(await principalCanAccessClient({ id: u.id, role: u.role }, 'c1', notOwns), false);
});

test('extension admin passes', async () => {
  const u = extUser('admin1', 'admin');
  assert.equal(await principalCanAccessClient({ id: u.id, role: u.role }, 'c1', notOwns), true);
});

test('clientId-scoping contract: an absent clientId is never allowed by the rule (routes skip the guard '
  + 'ONLY on paths that read no client data)', async () => {
  const u = extUser('rbt1', 'rbt');
  assert.equal(await principalCanAccessClient({ id: u.id, role: u.role }, undefined, owns), false);
  assert.equal(await principalCanAccessClient({ id: u.id, role: u.role }, null, owns), false);
});
