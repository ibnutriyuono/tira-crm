-- Target per Sales (SE) per bulan: pembagian target cabang oleh BM.
CREATE TABLE "SeTarget" (
    "id" TEXT NOT NULL,
    "se" TEXT NOT NULL,
    "cabang" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeTarget_se_periode_key" ON "SeTarget"("se", "periode");
CREATE INDEX "SeTarget_cabang_periode_idx" ON "SeTarget"("cabang", "periode");
