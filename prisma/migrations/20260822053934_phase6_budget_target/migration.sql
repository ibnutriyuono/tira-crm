-- CreateTable
CREATE TABLE "BudgetTarget" (
    "id" TEXT NOT NULL,
    "cabang" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetTarget_periode_idx" ON "BudgetTarget"("periode");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTarget_cabang_periode_key" ON "BudgetTarget"("cabang", "periode");
