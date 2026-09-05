// The ONE definition of "active" for a session note. Kept in its own PURE, import-free module so it is
// unit-testable with Node's built-in runner (sessionNotes.ts imports the Prisma client, which the test runner
// cannot resolve). sessionNotes.ts re-exports these, so every reader keeps importing from '@/lib/sessionNotes'.
//
// A session note is a CPT-97153 BILLING RECORD and is never destroyed. Replacing a date's note SUPERSEDES it
// (superseded_at set, retained) and deleting it SOFT-DELETES it (deleted_at set, retained + recoverable). So
// "active" = superseded_at IS NULL AND deleted_at IS NULL — spelled once, here, and never re-spelled so it can
// never drift and let a replaced or deleted row leak into a list, a dup check, the calendar, rotation, or
// continuity.

export const ACTIVE_NOTE_WHERE = { superseded_at: null, deleted_at: null } as const;

// Prisma `where` for "this client's active notes" (optionally for one session date).
export function activeNotesWhere(clientId: string, sessionDate?: string) {
  return { client_id: clientId, superseded_at: null, deleted_at: null, ...(sessionDate ? { session_date: sessionDate } : {}) };
}
