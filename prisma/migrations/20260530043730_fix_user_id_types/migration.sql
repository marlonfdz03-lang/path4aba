-- AlterTable
ALTER TABLE "bcba_clients" ALTER COLUMN "bcba_id" SET DATA TYPE TEXT,
ALTER COLUMN "rbt_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "fieldwork_monthly_summaries" ALTER COLUMN "user_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "fieldwork_profiles" ALTER COLUMN "user_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "fieldwork_sessions" ALTER COLUMN "user_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "user_id" SET DATA TYPE TEXT;
