-- Aktivitas harian Sales + target aktivitas bulanan per SE.
-- CreateTable
CREATE TABLE "SalesActivity" (
    "id" TEXT NOT NULL,
    "tanggal" TEXT NOT NULL,
    "se" TEXT NOT NULL,
    "cabang" TEXT,
    "reg" INTEGER,
    "tipe" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "keterangan" TEXT,
    "prospectId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityTarget" (
    "id" TEXT NOT NULL,
    "se" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "cabang" TEXT,
    "reg" INTEGER,
    "targets" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesActivity_tanggal_idx" ON "SalesActivity"("tanggal");
CREATE INDEX "SalesActivity_se_idx" ON "SalesActivity"("se");
CREATE INDEX "SalesActivity_cabang_idx" ON "SalesActivity"("cabang");
CREATE INDEX "SalesActivity_reg_idx" ON "SalesActivity"("reg");
CREATE INDEX "SalesActivity_prospectId_idx" ON "SalesActivity"("prospectId");
CREATE UNIQUE INDEX "ActivityTarget_se_periode_key" ON "ActivityTarget"("se", "periode");
CREATE INDEX "ActivityTarget_periode_idx" ON "ActivityTarget"("periode");
