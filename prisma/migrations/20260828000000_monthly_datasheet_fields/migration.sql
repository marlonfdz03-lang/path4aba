-- Monthly datasheet: schedule, per-program measurement config, and value provenance.
--
-- PURELY ADDITIVE. Nothing reads these yet — writers land in a separate commit. Every existing row is
-- untouched: no backfill, no DEFAULT that would fabricate a value, and user_confirmed is not modified
-- anywhere in this migration.
--
-- RUN MANUALLY WITH psql. Never `prisma db push`.


-- ── 1. clients.session_days ─────────────────────────────────────────────────────────────────────────
-- Which weekdays this client has sessions, as a JSON array of ISO weekday integers (1 = Monday … 7 =
-- Sunday), e.g. '[1,2,3,4,5]'.
--
-- NULL means UNKNOWN — we have never been told this client's schedule. It does NOT mean "no sessions".
-- A reader must treat NULL as "cannot determine expected sessions" and say so, never as an empty week
-- that would make every day look missed. An empty array '[]' is reserved for the different, deliberate
-- statement "this client has no scheduled session days"; nothing writes that yet.
--
-- NO DEFAULT, deliberately. Defaulting to Mon–Fri would assert a schedule for every existing client that
-- nobody has ever confirmed, and the whole point of this column is to stop inferring the week.
--
-- WHY JSONB AND NOT integer[]: Prisma cannot express a nullable scalar list — `Int[]?` fails validation
-- with "Optional lists are not supported" (P1012), and a plain `Int[]` is non-nullable and defaults to
-- '{}', which collapses UNKNOWN into "no sessions" — exactly the distinction this column exists to make.
-- JSONB keeps the column genuinely nullable and matches the house pattern for nullable structured data
-- (clients.clinical_profile, clients.treatment_map_data, maladaptive_data.daily_values).
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "session_days" JSONB;


-- ── 2. program_config ───────────────────────────────────────────────────────────────────────────────
-- Per-client, per-program MEASUREMENT settings: how a program is recorded, not what it is aiming for.
--
-- WHY THIS IS NOT stos. stos holds short-term OBJECTIVES — baseline_value, goal_value, target_date,
-- total_weeks, status — and answers "what are we aiming for and by when". It deliberately carries no
-- unique constraint, because one target accumulates many objectives over time. This table answers "how
-- do we record this program" and is unique per program, because a program has exactly one trial count.
-- Same subject, different question, opposite cardinality.
--
-- WHY THIS IS NOT clinical_profile. The obvious home for trials-per-target is inside each
-- maladaptiveBehaviors[] / replacementBehaviors[] entry — and those arrays are replaced WHOLESALE on
-- every reassessment: buildAssessmentProfile rebuilds each entry as exactly { name, status, topographies,
-- functions } from the PDF, so any extra per-item field is silently gone on the next upload. A sibling
-- top-level key would survive that spread, but not the undo path: /api/clients/[id]/profile/restore
-- replaces the entire profile with the pre-refresh snapshot, reverting any config written since — via a
-- button whose stated purpose is undoing an assessment, with no indication that settings went with it.
-- A table also buys what the JSON cannot: a real foreign key, a uniqueness guarantee, and per-row
-- timestamps.
--
-- program_name is free text matched against clinical_profile / maladaptive_data.behavior_name /
-- replacement_data.replacement_skill, none of which have a canonical key. It is therefore a soft
-- reference, not a foreign key — a renamed program orphans its config rather than corrupting it.
--
-- CASCADE on client delete: this is configuration, not evidence. Unlike admin_alerts (which must outlive
-- the row it describes), a deleted client's trial counts have no independent value.
CREATE TABLE IF NOT EXISTS "program_config" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"          UUID NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "program_name"       TEXT NOT NULL,                        -- soft reference; matched by name
  "program_type"       TEXT NOT NULL,                        -- 'maladaptive' | 'replacement'
  "trials_per_session" INTEGER,                              -- NULL = not configured; caller decides its own fallback
  "mastery_criterion"  TEXT,                                 -- free text, e.g. '80% across 3 consecutive sessions'
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- One config per program per client. program_type is part of the key because a behavior and a skill may
-- legitimately share a name. Leading column is client_id, so this index also serves every
-- "config for this client" lookup — a separate client_id index would be redundant.
CREATE UNIQUE INDEX IF NOT EXISTS "program_config_client_program_idx"
  ON "program_config" ("client_id", "program_name", "program_type");


-- ── 3. value_origin ─────────────────────────────────────────────────────────────────────────────────
-- Where a recorded value came from: 'estimated' | 'note_adjusted' | 'rbt_edited' | 'observed'.
--
-- Additive + nullable; existing rows stay NULL (legacy, provenance unknown). No existing-row data is
-- migrated. NULL must never be read as 'observed' — until this column exists the two are
-- indistinguishable, which is the reason for the column. Note that user_confirmed cannot substitute: it
-- is already true on generated values, because the autofill save path sets it.
--
-- Shape follows session_notes.status (migration 20260724000000): plain nullable TEXT, values enforced by
-- the writer rather than a CHECK or an enum, so adding a state later is a code change and not a migration.
ALTER TABLE "maladaptive_data" ADD COLUMN IF NOT EXISTS "value_origin" TEXT;
ALTER TABLE "replacement_data" ADD COLUMN IF NOT EXISTS "value_origin" TEXT;
