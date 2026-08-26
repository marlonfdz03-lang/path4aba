-- Admin alerts: the operational event feed behind the admin "auditors" panel.
--
-- WHY THIS IS NOT gate_findings. gate_findings answers "which clinical gate fired on a note that
-- SHIPPED" — it is a clinical-quality signal, defect-only, and by design records nothing when a note
-- is clean. This table answers a different question: "what happened in the system, succeeded or
-- failed". Its first and (for now) only producer is the note-generation hard-failure path, which
-- until this migration left NO trace anywhere at all — not a row, not a log line. The two tables stay
-- separate so neither one's retention, severity vocabulary, or read model constrains the other.
--
-- read_at is the panel's own state (NULL = unread), not a property of the event. It is indexed with
-- severity because "unread criticals" is the query the panel opens on.
--
-- client_id is TEXT and carries NO foreign key, deliberately: an alert is an audit record of
-- something that already went wrong, so it must outlive the row it refers to (a deleted client must
-- not CASCADE away the evidence) and the emitter must never fail because an id was malformed. Same
-- reasoning for actor_user_id.
--
-- PHI: payload holds diagnostics only — error messages, stacks, ids, short labels. NEVER note text,
-- never client-identifying content. Reached exclusively through admin-authenticated routes.
--
-- RUN MANUALLY WITH psql. Never `prisma db push`.

CREATE TABLE IF NOT EXISTS admin_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  source        text        NOT NULL,                    -- 'note' | 'extension' | 'system'
  type          text        NOT NULL,                    -- dotted event key, e.g. 'note.generation_failed'
  severity      text        NOT NULL,                    -- 'critical' | 'warning' | 'info'
  actor_user_id text,                                    -- the acting user, when there is one
  client_id     text,                                    -- the client in context, when there is one
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb, -- diagnostics only, never note text
  read_at       timestamptz                              -- NULL = unread in the admin panel
);

CREATE INDEX IF NOT EXISTS admin_alerts_created_at_idx ON admin_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_alerts_severity_read_at_idx ON admin_alerts (severity, read_at);
CREATE INDEX IF NOT EXISTS admin_alerts_type_created_at_idx ON admin_alerts (type, created_at DESC);
