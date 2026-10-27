-- Role baru: VP (seluruh divisi) dan GM Operation (Purchasing, IPC, gudang).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'vp';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'gmops';

-- Persetujuan margin Surat Penawaran oleh VP.
CREATE TABLE IF NOT EXISTS "MarginApproval" (
  "id" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "customer" TEXT NOT NULL,
  "cabang" TEXT,
  "se" TEXT,
  "nomor" TEXT,
  "items" JSONB NOT NULL,
  "priceKey" TEXT NOT NULL,
  "minMargin" DOUBLE PRECISION NOT NULL,
  "alasan" TEXT,
  "status" TEXT NOT NULL DEFAULT 'menunggu',
  "requestedById" TEXT NOT NULL,
  "requestedByName" TEXT NOT NULL,
  "decidedById" TEXT,
  "decidedByName" TEXT,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarginApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MarginApproval_prospectId_idx" ON "MarginApproval"("prospectId");
CREATE INDEX IF NOT EXISTS "MarginApproval_status_idx" ON "MarginApproval"("status");
