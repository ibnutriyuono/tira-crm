-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEntity" ADD VALUE 'vendor';
ALTER TYPE "ActivityEntity" ADD VALUE 'fupa';
ALTER TYPE "ActivityEntity" ADD VALUE 'quotation';
ALTER TYPE "ActivityEntity" ADD VALUE 'budget';
ALTER TYPE "ActivityEntity" ADD VALUE 'chat';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'purchasing';

-- AlterTable
ALTER TABLE "Rfq" ADD COLUMN     "reg" INTEGER;

-- CreateIndex
CREATE INDEX "Rfq_cabang_idx" ON "Rfq"("cabang");

-- CreateIndex
CREATE INDEX "Rfq_reg_idx" ON "Rfq"("reg");

-- CreateIndex
CREATE INDEX "Rfq_requestedBy_idx" ON "Rfq"("requestedBy");

-- Backfill the denormalized region from the RFQ's source prospect. RFQs with
-- no prospectId (or a prospect with no reg) stay NULL and fall outside
-- rm-scoped queries, which matches how the single-file app behaved.
UPDATE "Rfq" r
SET "reg" = p."reg"
FROM "Prospect" p
WHERE r."prospectId" = p."id" AND r."reg" IS NULL;
