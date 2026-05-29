/*
  Warnings:

  - The primary key for the `bcba_notes` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `bcba_notes` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "bcba_notes" DROP CONSTRAINT "bcba_notes_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "bcba_notes_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "behaviors" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "active_behaviors" JSONB,
ADD COLUMN     "agency_id" UUID,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "diagnosis" TEXT,
ADD COLUMN     "primary_setting" TEXT,
ADD COLUMN     "rbt_id" UUID;

-- AlterTable
ALTER TABLE "fieldwork_profiles" ADD COLUMN     "country_of_fieldwork" TEXT,
ADD COLUMN     "start_date" TEXT,
ADD COLUMN     "state_of_fieldwork" TEXT,
ADD COLUMN     "supervisor_email" TEXT;

-- AlterTable
ALTER TABLE "replacement_skills" ADD COLUMN     "teaching_procedure" TEXT,
ADD COLUMN     "vocabulary_variants" TEXT[];

-- AlterTable
ALTER TABLE "topographies" ADD COLUMN     "vocabulary_variants" TEXT[];
