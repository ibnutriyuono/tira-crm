-- AlterTable
ALTER TABLE "Rfq" ADD COLUMN     "fupaId" TEXT,
ADD COLUMN     "purchStatus" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Fupa" (
    "id" TEXT NOT NULL,
    "noFupa" TEXT,
    "tglFupa" TEXT,
    "sourceRfqId" TEXT,
    "sourceNoRfq" TEXT,
    "cabang" TEXT,
    "reg" INTEGER,
    "customer" TEXT,
    "requestedBy" TEXT,
    "prospectId" TEXT,
    "items" JSONB NOT NULL,
    "catatan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "purchStatus" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fupa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "rfqId" TEXT,
    "fupaId" TEXT,
    "tglDiminta" TEXT,
    "channel" TEXT,
    "harga" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leadTime" INTEGER NOT NULL DEFAULT 0,
    "catatan" TEXT,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fupa_cabang_idx" ON "Fupa"("cabang");

-- CreateIndex
CREATE INDEX "Fupa_reg_idx" ON "Fupa"("reg");

-- CreateIndex
CREATE INDEX "Fupa_requestedBy_idx" ON "Fupa"("requestedBy");

-- CreateIndex
CREATE INDEX "Fupa_purchStatus_idx" ON "Fupa"("purchStatus");

-- CreateIndex
CREATE INDEX "Fupa_sourceRfqId_idx" ON "Fupa"("sourceRfqId");

-- CreateIndex
CREATE INDEX "Quotation_vendorId_idx" ON "Quotation"("vendorId");

-- CreateIndex
CREATE INDEX "Quotation_rfqId_idx" ON "Quotation"("rfqId");

-- CreateIndex
CREATE INDEX "Quotation_fupaId_idx" ON "Quotation"("fupaId");

-- CreateIndex
CREATE INDEX "Rfq_purchStatus_idx" ON "Rfq"("purchStatus");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_fupaId_fkey" FOREIGN KEY ("fupaId") REFERENCES "Fupa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
