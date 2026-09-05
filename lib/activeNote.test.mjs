// The ONE definition of "active" for a session note. A note is a billing record: it is never destroyed —
// replacing it SUPERSEDES it and deleting it SOFT-DELETES it, both retained. "Active" must therefore exclude
// BOTH superseded_at and deleted_at, in the single shared where-clause every reader imports. These tests pin
// that: if either predicate is ever dropped, a replaced or deleted note would leak back into lists, the
// calendar, dup checks, rotation, and continuity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_NOTE_WHERE, activeNotesWhere } from './activeNote.ts';

test('ACTIVE_NOTE_WHERE excludes BOTH superseded and deleted notes', () => {
  assert.deepEqual({ ...ACTIVE_NOTE_WHERE }, { superseded_at: null, deleted_at: null });
});

test('activeNotesWhere(clientId) scopes to the client and excludes superseded + deleted', () => {
  assert.deepEqual(activeNotesWhere('c1'), { client_id: 'c1', superseded_at: null, deleted_at: null });
});

test('activeNotesWhere(clientId, date) adds the session_date, keeping both exclusions', () => {
  assert.deepEqual(activeNotesWhere('c1', '2026-09-05'), {
    client_id: 'c1', superseded_at: null, deleted_at: null, session_date: '2026-09-05',
  });
});

test('deleted-exclusion is present (a soft-deleted note can never be "active")', () => {
  // Guard specifically against a regression that drops deleted_at from the shared filter.
  assert.ok('deleted_at' in ACTIVE_NOTE_WHERE, 'ACTIVE_NOTE_WHERE must filter deleted_at');
  assert.equal(ACTIVE_NOTE_WHERE.deleted_at, null);
  assert.equal(activeNotesWhere('c1').deleted_at, null);
});
