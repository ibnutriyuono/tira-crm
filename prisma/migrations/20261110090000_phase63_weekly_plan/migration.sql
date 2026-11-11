-- Rencana Penjualan mingguan: riwayat tambah / pindah / hapus per baris rencana.
CREATE TABLE "SalesPlanChange" (
    "id" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "se" TEXT NOT NULL,
    "cabang" TEXT,
    "reg" INTEGER,
    "action" TEXT NOT NULL,
    "minggu" INTEGER,
    "fromMinggu" INTEGER,
    "prospectId" TEXT,
    "customer" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "nilai" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesPlanChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesPlanChange_periode_idx" ON "SalesPlanChange"("periode");
CREATE INDEX "SalesPlanChange_cabang_idx" ON "SalesPlanChange"("cabang");
CREATE INDEX "SalesPlanChange_prospectId_idx" ON "SalesPlanChange"("prospectId");
