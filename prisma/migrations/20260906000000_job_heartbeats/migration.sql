-- job_heartbeats: the scheduler's "I succeeded" record. One row per job, keyed by job_name.
--
-- Written ONLY on a job's SUCCESSFUL completion (never at start, never in a catch) so a job that
-- starts and throws leaves last_success_at untouched — and both the SQL staleness query below and the
-- external dead-man's switch (Healthchecks.io) fire. A run that legitimately did nothing (e.g. zero
-- users in a reminder window) still counts as a success and still writes here, so a quiet day reads
-- as green, not as a dead job.
--
-- WHY expected_interval LIVES IN THE ROW, NOT IN CODE:
--   (1) the staleness query is then pure SQL needing no app import —
--         SELECT job_name FROM job_heartbeats WHERE last_success_at < now() - expected_interval;
--       finds every overdue job by itself, runnable from psql, a monitor, or an admin page;
--   (2) an operator can retune one job's tolerance with a single UPDATE, no deploy;
--   (3) it is the SINGLE source of truth the noticer reads, so it cannot drift from a separate code
--       constant — which is exactly how vercel.json's cron schedule drifted from the real deployment
--       (the crons stopped firing at the Vercel->Azure move and nothing noticed for ~3 months).
--   The per-success upsert in lib/jobHeartbeat.ts sets expected_interval on first INSERT and LEAVES IT
--   ALONE on CONFLICT, so a hand-tuned value is never clobbered by the next successful run.
--
-- The table self-seeds: each job INSERTs its own row on first success, so no seed rows are needed here.
-- No secondary index — the table holds a handful of rows; the PK covers lookups and the staleness scan
-- is a trivial sequential scan.
--
-- last_run_note is a short success summary (counts) for a human glancing at the table — NEVER PHI.
-- RUN MANUALLY WITH psql. Never `prisma db push`.

CREATE TABLE IF NOT EXISTS job_heartbeats (
  job_name          text        PRIMARY KEY,      -- stable id, e.g. 'reconcile-subscriptions'
  last_success_at   timestamptz NOT NULL,         -- upserted ONLY on successful completion
  expected_interval interval    NOT NULL,         -- the SLA: how often this job should succeed
  last_run_note     text,                         -- short success summary (counts), never PHI
  updated_at        timestamptz NOT NULL DEFAULT now()
);
