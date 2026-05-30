CREATE TABLE "replacement_data" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id"           UUID NOT NULL,
    "session_date"        TEXT,
    "location"            TEXT,
    "session_time_in"     TEXT,
    "session_time_out"    TEXT,
    "rbt_name"            TEXT,
    "platform_source"     TEXT,
    "replacement_skill"   TEXT NOT NULL,
    "total_trials"        INTEGER NOT NULL,
    "observed_percentage" DOUBLE PRECISION NOT NULL,
    "correct_count"       INTEGER NOT NULL,
    "incorrect_count"     INTEGER NOT NULL,
    "alternated_sequence" TEXT,
    "user_confirmed"      BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at"        TIMESTAMPTZ,
    "autofill_completed"  BOOLEAN NOT NULL DEFAULT false,
    "created_at"          TIMESTAMPTZ DEFAULT now(),
    "updated_at"          TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "replacement_data_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "replacement_data"
    ADD CONSTRAINT "replacement_data_client_id_fkey"
    FOREIGN KEY ("client_id")
    REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
