-- Clinical Library: a deduplicated, admin-curated corpus of clinical vocabulary accumulated across every
-- ingested assessment, to power the future Assessment Builder's autocomplete. SEPARATE from the note-gen
-- knowledge base (behaviors/topographies/replacement_skills) on purpose — admin curation (edit/merge/delete)
-- must never affect note generation.
--
-- One row per canonical entry, enforced by the UNIQUE (kind, canonical_key). New variants/functions
-- accumulate onto the existing row; a normalizer produces canonical_key so "Tantrum" / "tantrums" /
-- "Tantrum Behavior" collapse to ONE row. Holds clinical vocabulary only — a conservative PHI discard filter
-- runs before anything is written, and the discards table logs count + reason category (NEVER the text).
--
-- RUN MANUALLY WITH psql. Never `prisma db push`.

CREATE TABLE "clinical_library" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"          TEXT NOT NULL,                       -- 'behavior' | 'skill' | 'procedure' | 'reinforcer' | 'activity'
  "canonical_key" TEXT NOT NULL,                       -- normalized dedup key
  "display_name"  TEXT NOT NULL,                       -- human-readable canonical name (curator can rename)
  "variants"      TEXT[] NOT NULL DEFAULT '{}',        -- accumulated variant strings (topographies / descriptions / alt spellings)
  "functions"     TEXT[] NOT NULL DEFAULT '{}',        -- behaviors: accumulated function names
  "meta"          JSONB,                               -- links: { targetFunction, skills:[…], setting }
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "clinical_library_kind_key_idx" ON "clinical_library" ("kind", "canonical_key");
CREATE INDEX "clinical_library_kind_idx" ON "clinical_library" ("kind");

CREATE TABLE "clinical_library_discards" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"       TEXT NOT NULL,                          -- what kind of entry was being added
  "reason"     TEXT NOT NULL,                          -- 'proper-name' | 'location' | 'date' | 'age' | 'hipaa-id'
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "clinical_library_discards_reason_idx" ON "clinical_library_discards" ("reason");
CREATE INDEX "clinical_library_discards_created_at_idx" ON "clinical_library_discards" ("created_at");
