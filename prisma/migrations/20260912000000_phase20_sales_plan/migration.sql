-- Rencana Penjualan (Sales Plan): one itemized plan per SE per month, rolled
-- up SE -> cabang -> regional -> nasional. cabang/reg are denormalized from
-- the author's account at save time, mirroring Rfq/Fupa, so the rollups never
-- have to join back to User.

-- CreateTable
CREATE TABLE "SalesPlan" (
    "id"          TEXT NOT NULL,
    "periode"     TEXT NOT NULL,
    "se"          TEXT NOT NULL,
    "cabang"      TEXT,
    "reg"         INTEGER,
    "items"       JSONB NOT NULL DEFAULT '[]',
    "value"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requestedBy" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlan_pkey" PRIMARY KEY ("id")
);

-- One plan per SE per month: re-filling the same month updates that row
-- rather than appending a second one.
CREATE UNIQUE INDEX "SalesPlan_se_periode_key" ON "SalesPlan"("se", "periode");
CREATE INDEX "SalesPlan_periode_idx" ON "SalesPlan"("periode");
CREATE INDEX "SalesPlan_cabang_idx"  ON "SalesPlan"("cabang");
CREATE INDEX "SalesPlan_reg_idx"     ON "SalesPlan"("reg");

-- The audit trail logs sales-plan edits as entity 'salesPlan'. logActivity()
-- swallows its own errors, so without this enum value every plan would save
-- successfully while silently writing no audit row.
ALTER TYPE "ActivityEntity" ADD VALUE 'salesPlan';
