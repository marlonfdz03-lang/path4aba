-- Subscription change audit log (append-only).
--
-- APPLIED MANUALLY VIA psql on the live database (table + 4 indexes + 9 baseline rows) — this file is
-- committed for repo/schema parity. Prisma's _prisma_migrations table does NOT yet know this migration is
-- applied; run once, manually, to record it (so a future `prisma migrate deploy` will not try to re-run it):
--     prisma migrate resolve --applied 20260829000000_subscription_events
--
-- PURELY ADDITIVE: creates one new table, touches nothing else. The subscriptions row is a single overwritten
-- row per user with no history; this table records every plan change, status change, and (critically) every
-- stripe_subscription_id replacement, which orphans the old Stripe subscription. user_id is nullable and NOT a
-- foreign key so a webhook for an orphaned/unknown customer is still recordable. Writers land separately.
--
-- The 9 baseline rows (one per existing subscriptions row) were seeded once, manually, and are intentionally
-- NOT in this migration — re-running the seed on another environment would double-seed. The one-time seed was:
--     INSERT INTO subscription_events
--       (user_id, stripe_customer_id, stripe_subscription_id, event_type, source, new_plan, new_status, new_subscription_id, created_at)
--     SELECT user_id, stripe_customer_id, stripe_subscription_id, 'baseline', 'baseline', plan, status, stripe_subscription_id, now()
--     FROM subscriptions;

CREATE TABLE subscription_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                text NULL,
  stripe_customer_id     text NULL,
  stripe_subscription_id text NULL,
  event_type             text NOT NULL,
  source                 text NOT NULL,
  stripe_event_id        text NULL,
  old_plan               text NULL,
  new_plan               text NULL,
  old_status             text NULL,
  new_status             text NULL,
  old_subscription_id    text NULL,
  new_subscription_id    text NULL,
  metadata               jsonb NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subevents_user    ON subscription_events (user_id);
CREATE INDEX idx_subevents_sub     ON subscription_events (stripe_subscription_id);
CREATE INDEX idx_subevents_created ON subscription_events (created_at DESC);
CREATE INDEX idx_subevents_event   ON subscription_events (stripe_event_id);
