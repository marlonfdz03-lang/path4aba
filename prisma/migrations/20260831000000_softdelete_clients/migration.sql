-- Soft-delete for clients. A client owns CPT-97153 session notes (BILLING RECORDS, including the superseded
-- rows we deliberately retain), assessment PDFs, and every per-client data table — all wired onDelete: Cascade.
-- A hard DELETE therefore destroyed all of it irreversibly and defeated the supersede-never-destroys guarantee.
-- Soft-delete keeps the client row alive (nothing cascades) and hides it from every read via the model-scoped
-- Prisma extension in lib/prisma.ts (mirrors fieldwork_sessions).
--   deleted_at  NULL = active; a timestamp = archived (row + all children retained, restorable).
--   deleted_by  who archived it (audit; matches fieldwork_sessions).
-- No index: clients is tiny (~11 rows), so `deleted_at IS NULL` is a seq scan either way (fieldwork added none).
-- Additive, nullable, no default, NO backfill -> every existing client becomes active (NULL). No-op on deploy.
-- RUN MANUALLY WITH psql. Never `prisma db push`.
ALTER TABLE "clients" ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN "deleted_by" TEXT;
