-- Compliance-gate findings.
--
-- The gates NEVER block a note reaching the RBT: a clinical gate firing is a signal to US, not a
-- failure for them. Every finding is recorded here silently and reviewed in the admin panel, so a
-- recurring defect can be fixed at its root instead of surfacing as "note could not be generated".
--
-- PHI: holds NO note text. Ids and short clinical labels only — enough to diagnose, nothing more.
-- Reached exclusively through admin-authenticated routes.
--
-- RUN MANUALLY WITH psql. Never `prisma db push`.

CREATE TABLE IF NOT EXISTS gate_findings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  user_id     text,
  note_id     uuid,
  source      text        NOT NULL,   -- 'generate' | 'refine'
  gate        text        NOT NULL,   -- 'intervention' | 'approved-function' | 'coverage' | 'teaching-method' | 'coherence' | 'red-flag' | 'similarity' | 'blocked-term' | 'data-integrity'
  severity    text        NOT NULL,   -- 'critical' (prohibited procedure) | 'warning' | 'info'
  detail      text        NOT NULL,   -- short, human-readable
  context     jsonb,                  -- ids/labels only, never note text
  regen_count smallint
);

CREATE INDEX IF NOT EXISTS gate_findings_created_at_idx ON gate_findings (created_at DESC);
CREATE INDEX IF NOT EXISTS gate_findings_gate_created_at_idx ON gate_findings (gate, created_at DESC);
CREATE INDEX IF NOT EXISTS gate_findings_severity_created_at_idx ON gate_findings (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS gate_findings_client_id_idx ON gate_findings (client_id);
