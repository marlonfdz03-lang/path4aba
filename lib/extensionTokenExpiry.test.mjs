// Sliding idle-window expiry for extension tokens (lib/extensionTokenExpiry.ts). Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTokenExpired, tokenIdleMs, EXTENSION_TOKEN_IDLE_MS } from './extensionTokenExpiry.ts';

const NOW = Date.UTC(2026, 7, 29); // fixed reference so the test is deterministic
const daysAgo = (d) => new Date(NOW - d * 86400000);

test('window is 60 days', () => {
  assert.equal(EXTENSION_TOKEN_IDLE_MS, 60 * 24 * 60 * 60 * 1000);
});

test('used yesterday → NOT expired', () => {
  assert.equal(isTokenExpired(daysAgo(1), daysAgo(90), NOW), false);
});

test('used 61 days ago → expired', () => {
  assert.equal(isTokenExpired(daysAgo(61), daysAgo(90), NOW), true);
});

test('never used → falls back to created_at (61d old → expired, 1d old → not)', () => {
  assert.equal(isTokenExpired(null, daysAgo(61), NOW), true);
  assert.equal(isTokenExpired(null, daysAgo(1), NOW), false);
  assert.equal(isTokenExpired(undefined, daysAgo(1), NOW), false);
});

test('boundary: 59 days not expired, 61 days expired', () => {
  assert.equal(isTokenExpired(daysAgo(59), daysAgo(90), NOW), false);
  assert.equal(isTokenExpired(daysAgo(61), daysAgo(90), NOW), true);
});

test('FAIL CLOSED: missing/unparseable dates → expired (deny)', () => {
  assert.equal(isTokenExpired(null, null, NOW), true);
  assert.equal(isTokenExpired(undefined, undefined, NOW), true);
  assert.equal(isTokenExpired('not-a-date', 'also-bad', NOW), true);
});

test('tokenIdleMs uses last_used_at over created_at, and NaN on bad input', () => {
  assert.equal(tokenIdleMs(daysAgo(2), daysAgo(90), NOW), 2 * 86400000);
  assert.equal(tokenIdleMs(null, daysAgo(5), NOW), 5 * 86400000);
  assert.equal(Number.isNaN(tokenIdleMs(null, null, NOW)), true);
});

test('accepts ISO strings as well as Date objects', () => {
  assert.equal(isTokenExpired(daysAgo(1).toISOString(), daysAgo(90).toISOString(), NOW), false);
  assert.equal(isTokenExpired(daysAgo(61).toISOString(), daysAgo(90).toISOString(), NOW), true);
});
