-- DropForeignKey
ALTER TABLE "extension_tokens" DROP CONSTRAINT "fk_ext_tokens_user";

-- DropIndex
DROP INDEX "idx_ext_tokens_user_id";

-- AlterTable
ALTER TABLE "maladaptive_data" ADD COLUMN     "anomaly_justification" TEXT,
ADD COLUMN     "anomaly_reviewed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_anomaly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_value" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "replacement_data" ADD COLUMN     "anomaly_justification" TEXT,
ADD COLUMN     "anomaly_reviewed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_anomaly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_value" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
