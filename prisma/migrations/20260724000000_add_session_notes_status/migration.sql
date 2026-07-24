-- AlterTable
-- Authoritative lifecycle marker: 'saved' | 'used' | 'draft'. Additive + nullable; existing rows
-- stay NULL (legacy, provenance unknown). No existing-row data is migrated.
ALTER TABLE "session_notes" ADD COLUMN     "status" TEXT;
