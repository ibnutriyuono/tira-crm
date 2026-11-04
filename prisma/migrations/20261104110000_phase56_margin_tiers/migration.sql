-- Persetujuan margin bertingkat (BM -> RM -> GM -> VP).
ALTER TABLE "MarginApproval" ADD COLUMN IF NOT EXISTS "level" TEXT NOT NULL DEFAULT 'vp';
ALTER TABLE "MarginApproval" ADD COLUMN IF NOT EXISTS "lowestMargin" DOUBLE PRECISION;
ALTER TABLE "MarginApproval" ADD COLUMN IF NOT EXISTS "reg" INTEGER;
