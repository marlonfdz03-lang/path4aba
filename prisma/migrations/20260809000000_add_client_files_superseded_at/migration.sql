-- Soft-delete marker for client_files: superseded_at is NULL for the CURRENT assessment PDF, and a timestamp
-- for a PDF that has been superseded by a newer upload. The bytes are RETAINED (never deleted here) — this
-- only hides prior assessments from the default Files list while keeping them recoverable by id, matching the
-- privacy policy's up-to-7-year retention of clinical documents. A future purge job deletes rows where
-- superseded_at < now() - interval '7 years'. Additive, nullable, no default → all existing rows become
-- current (NULL). No data loss.
ALTER TABLE "client_files" ADD COLUMN "superseded_at" TIMESTAMPTZ(6);
