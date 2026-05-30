-- Add week columns to replacement_data
ALTER TABLE "replacement_data"
  ADD COLUMN IF NOT EXISTS "week_start"        TEXT,
  ADD COLUMN IF NOT EXISTS "week_end"          TEXT,
  ADD COLUMN IF NOT EXISTS "projected_value"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "goal_met"          TEXT,
  ADD COLUMN IF NOT EXISTS "week_confirmed"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "week_confirmed_at" TIMESTAMPTZ;

-- Create maladaptive_data table
CREATE TABLE IF NOT EXISTS "maladaptive_data" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "client_id"       UUID        NOT NULL,
    "behavior_name"   TEXT        NOT NULL,
    "week_start"      TEXT,
    "week_end"        TEXT,
    "session_date"    TEXT,
    "frequency"       INTEGER,
    "rate"            DOUBLE PRECISION,
    "duration"        DOUBLE PRECISION,
    "trials"          INTEGER,
    "daily_values"    JSONB,
    "user_confirmed"  BOOLEAN     NOT NULL DEFAULT false,
    "confirmed_at"    TIMESTAMPTZ,
    "projected_value" DOUBLE PRECISION,
    "goal_met"        TEXT,
    "created_at"      TIMESTAMPTZ DEFAULT now(),
    "updated_at"      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT "maladaptive_data_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "maladaptive_data"
  ADD CONSTRAINT "maladaptive_data_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create stos table
CREATE TABLE IF NOT EXISTS "stos" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "client_id"      UUID        NOT NULL,
    "target_name"    TEXT        NOT NULL,
    "target_type"    TEXT        NOT NULL,
    "baseline_value" DOUBLE PRECISION NOT NULL,
    "goal_value"     DOUBLE PRECISION NOT NULL,
    "start_date"     TEXT,
    "target_date"    TEXT,
    "total_weeks"    INTEGER     NOT NULL DEFAULT 16,
    "status"         TEXT        NOT NULL DEFAULT 'active',
    "created_at"     TIMESTAMPTZ DEFAULT now(),
    "updated_at"     TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT "stos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stos"
  ADD CONSTRAINT "stos_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
