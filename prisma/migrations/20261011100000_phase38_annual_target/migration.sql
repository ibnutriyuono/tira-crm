-- Target tahunan per cabang; target bulanan default = tahunan / 12.
ALTER TABLE "BudgetTarget" ADD COLUMN "fromAnnual" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AnnualTarget" (
    "id" TEXT NOT NULL,
    "cabang" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnualTarget_cabang_year_key" ON "AnnualTarget"("cabang", "year");
CREATE INDEX "AnnualTarget_year_idx" ON "AnnualTarget"("year");
