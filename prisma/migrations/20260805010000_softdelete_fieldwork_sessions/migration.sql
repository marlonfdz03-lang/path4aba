
-- AlterTable
ALTER TABLE "fieldwork_sessions" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "deleted_by" TEXT;

