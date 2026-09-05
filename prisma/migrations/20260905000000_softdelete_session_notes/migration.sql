-- Soft-delete for session_notes. A note is a billing record; the DELETE button used to run
-- prisma.session_notes.delete (a HARD delete that destroyed the row with no trace). This mirrors the client
-- archive + the note supersede: mark the row, never drop it. "Active" = superseded_at IS NULL AND deleted_at
-- IS NULL (lib/sessionNotes.ts). Recover a deleted note with scripts/restore-note.ts.
ALTER TABLE "session_notes"
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
  ADD COLUMN "deleted_by" TEXT;

-- Partial index for the active-note lookups every reader runs (client list, dates, dup check, rotation,
-- dashboard). Matches the "active" predicate so it stays covering after this change.
CREATE INDEX IF NOT EXISTS "session_notes_active_idx"
  ON "session_notes" ("client_id")
  WHERE "superseded_at" IS NULL AND "deleted_at" IS NULL;
