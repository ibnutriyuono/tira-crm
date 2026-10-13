-- Masalah pipeline per prospek
CREATE TABLE "ProspectIssue" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "kategori" TEXT NOT NULL,
    "urgensi" TEXT NOT NULL DEFAULT 'sedang',
    "keterangan" TEXT NOT NULL DEFAULT '',
    "targetDate" TEXT,
    "pjIds" JSONB NOT NULL DEFAULT '[]',
    "se" TEXT,
    "cabang" TEXT,
    "reg" INTEGER,
    "customer" TEXT NOT NULL DEFAULT '',
    "saran" TEXT,
    "diajukanOleh" TEXT,
    "diajukanNama" TEXT,
    "dilaporOleh" TEXT,
    "dilaporNama" TEXT,
    "dilaporAt" TIMESTAMP(3),
    "ditanganiAt" TIMESTAMP(3),
    "ditanganiNama" TEXT,
    "selesaiAt" TIMESTAMP(3),
    "selesaiNama" TEXT,
    "solusi" TEXT,
    "hasil" TEXT,
    "alasanTolak" TEXT,
    "eskalasi" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProspectIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProspectIssue_prospectId_status_idx" ON "ProspectIssue"("prospectId", "status");
CREATE INDEX "ProspectIssue_status_cabang_idx" ON "ProspectIssue"("status", "cabang");
