-- Shared host-EHR blocked-narrative terms (payer-compliance rejections like "sensory", "academic", "calm").
-- WHY shared: today learned terms live PER-CLIENT in clinical_profile.blockedNarrativeTerms, so a term learned
-- on one client never protects the next RBT. This promotes them to ONE shared set that protects every client.
-- GLOBAL first (the `ehr` column is nullable now); per-EHR later, once the extension sends its host identity.
-- Run via psql (NEVER prisma db push):  psql "$DATABASE_URL" -f scripts/blocked-narrative-terms-table.sql
--
-- substitute NULL  = FLAG-ONLY (surfaced to the RBT; the note is NOT auto-rewritten — used where no safe
--                     single-word observable swap exists, or a word we only suspect the EHR blocks).
-- substitute set   = auto-substituted BEFORE the note is autofilled, so the RBT never sees the EHR rejection.

CREATE TABLE IF NOT EXISTS blocked_narrative_terms (
  term        text PRIMARY KEY,        -- lowercased, whole-word
  substitute  text,                    -- NULL = flag-only
  ehr         text,                    -- NULL now (global); per-EHR later
  first_seen  timestamptz NOT NULL DEFAULT now(),
  source      text                     -- 'seed' | 'migrated:per-client' | 'learned'
);

-- 1) Migrate any existing per-client learned terms into the shared set (currently 0; kept for completeness).
INSERT INTO blocked_narrative_terms (term, substitute, source)
SELECT lower(COALESCE(e->>'term', e#>>'{}')) AS term, MAX(e->>'substitute') AS substitute, 'migrated:per-client'
FROM clients c
CROSS JOIN LATERAL jsonb_array_elements(c.clinical_profile->'blockedNarrativeTerms') e
WHERE jsonb_typeof(c.clinical_profile->'blockedNarrativeTerms') = 'array'
GROUP BY 1
ON CONFLICT (term) DO NOTHING;

-- 2) Seed — CONFIRMED EHR rejections (safe observable substitutes):
INSERT INTO blocked_narrative_terms (term, substitute, source) VALUES
  ('sensory',  'tactile',    'seed'),
  ('academic', 'structured', 'seed'),
  ('calm',     'quiet',      'seed'),
  ('calmed',   'quieted',    'seed')
ON CONFLICT (term) DO NOTHING;

-- 3) PROACTIVE seed — predictable rejections, FLAG-ONLY (no safe single-word swap; the masterPrompt prevents
--    them, and the RBT is warned pre-fill). Mentalistic internal states + non-ABA-service references.
--    >>> Marlon: review this list before running — move any to a substitute if you want it auto-fixed. <<<
INSERT INTO blocked_narrative_terms (term, substitute, source) VALUES
  ('frustrated', NULL, 'seed'), ('upset', NULL, 'seed'), ('anxious', NULL, 'seed'),
  ('angry', NULL, 'seed'), ('dysregulated', NULL, 'seed'), ('regulated', NULL, 'seed'),
  ('escalated', NULL, 'seed'), ('motivated', NULL, 'seed'),
  ('speech therapy', NULL, 'seed'), ('occupational therapy', NULL, 'seed'),
  ('physical therapy', NULL, 'seed'), ('counseling', NULL, 'seed'), ('tutoring', NULL, 'seed')
ON CONFLICT (term) DO NOTHING;
