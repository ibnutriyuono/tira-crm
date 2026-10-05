-- Phase 28: perencanaan & realisasi perjalanan GM / RM / BM ke customer.
CREATE TABLE "VisitTrip" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "ownerCabang" TEXT,
    "ownerReg" INTEGER,
    "cabang" TEXT NOT NULL,
    "reg" INTEGER,
    "tglBerangkat" TEXT NOT NULL,
    "tglPulang" TEXT NOT NULL,
    "keperluan" TEXT,
    "visits" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "approverName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "catatanRealisasi" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VisitTrip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VisitTrip_ownerId_idx" ON "VisitTrip"("ownerId");
CREATE INDEX "VisitTrip_cabang_idx" ON "VisitTrip"("cabang");
CREATE INDEX "VisitTrip_status_idx" ON "VisitTrip"("status");
CREATE INDEX "VisitTrip_tglBerangkat_idx" ON "VisitTrip"("tglBerangkat");
