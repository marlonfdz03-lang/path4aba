-- Content-based idempotency for session_notes: block byte-identical notes per client from ANY write
-- path (generateSmartNote auto-save, /api/session-notes, /api/extension/save-note), while still
-- allowing multiple DIFFERENT notes on the same date (a legitimate second session in one day).
--
-- Keyed on (client_id, md5(note_text)) — the same key scripts/dedup-session-notes.ts groups on.
-- md5(NULL) is NULL and unique indexes permit multiple NULLs, so localStorage-only rows with a NULL
-- note_text are unaffected.
--
-- ORDER OF OPERATIONS (important): CREATE UNIQUE INDEX FAILS if duplicates still exist. Run
-- scripts/dedup-session-notes.ts --apply FIRST, then this. Not run inside a prisma migration because
-- a functional (md5) index is not expressible in the Prisma schema.

CREATE UNIQUE INDEX IF NOT EXISTS session_notes_client_content_uidx
  ON session_notes (client_id, md5(note_text));
