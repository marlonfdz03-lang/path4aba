// Post-deploy chunk-reload logic. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChunkLoadError, shouldReloadForChunkError, CHUNK_RELOAD_COOLDOWN_MS } from './chunkReload.ts';

test('detects the chunk-load error shapes across bundlers/browsers', () => {
  assert.equal(isChunkLoadError({ name: 'ChunkLoadError', message: 'x' }), true);
  assert.equal(isChunkLoadError(new Error('Loading chunk 493 failed.')), true);
  assert.equal(isChunkLoadError(new Error('Loading CSS chunk app-layout failed')), true);
  assert.equal(isChunkLoadError('ChunkLoadError: Loading chunk vendors-abc123 failed'), true);
  assert.equal(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://…/page-abc.js')), true);
  assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true); // Safari
});

test('does NOT fire on ordinary runtime errors (must never reload the page for these)', () => {
  assert.equal(isChunkLoadError(new Error('Cannot read properties of undefined')), false);
  assert.equal(isChunkLoadError(new TypeError('x is not a function')), false);
  assert.equal(isChunkLoadError('NetworkError when attempting to fetch resource'), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
  assert.equal(isChunkLoadError(''), false);
});

test('cooldown: reload once, then not again within the window (broken-build loop guard)', () => {
  assert.equal(shouldReloadForChunkError(1_000_000, 0), true, 'never reloaded → reload');
  assert.equal(shouldReloadForChunkError(1_000_500, 1_000_000), false, '500ms later → within cooldown → do NOT reload');
  assert.equal(shouldReloadForChunkError(1_000_000 + CHUNK_RELOAD_COOLDOWN_MS, 1_000_000), true, 'exactly at cooldown → reload');
  assert.equal(shouldReloadForChunkError(2_000_000, 1_000_000), true, 'much later (a new deploy) → reload again');
  assert.equal(shouldReloadForChunkError(NaN, 0), false, 'bad clock → do not reload');
});
