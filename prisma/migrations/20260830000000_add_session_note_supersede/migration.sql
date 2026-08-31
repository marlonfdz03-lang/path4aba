-- Soft-supersede for session notes. A CPT-97153 session note is a BILLING RECORD and is NEVER destroyed:
-- when a date's note is REPLACED, the old row is retained and marked here, and a new row becomes the active
-- note for that date. Mirrors client_files.superseded_at, plus the old->new pointer.
--   superseded_at  NULL = active/current; a timestamp = when it was replaced (row retained, auditable).
--   superseded_by  id of the replacing note (the old->new link — a dead row with no pointer answers nothing).
--                  Soft reference, no FK: a note is never deleted so the target always exists, and this matches
--                  the codebase's provenance-pointer convention (admin_alerts, program_config).
-- Additive, nullable, no default, NO backfill -> every existing row becomes active (NULL). No data loss, and
-- the "active" filter (superseded_at IS NULL) matches every existing row, so it is a no-op on deploy.
-- RUN MANUALLY WITH psql. Never `prisma db push`.
ALTER TABLE "session_notes" ADD COLUMN "superseded_at" TIMESTAMPTZ(6);
ALTER TABLE "session_notes" ADD COLUMN "superseded_by" UUID;

-- The calendar's hot path is "active notes for this client, by date", called on every picker open, and
-- session_notes has no indexes at all today (even the existing GET scans). Partial index over current rows only.
CREATE INDEX "session_notes_active_by_client_date"
  ON "session_notes" ("client_id", "session_date")
  WHERE "superseded_at" IS NULL;
