-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT,
    "fupaId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_key_key" ON "Attachment"("key");

-- CreateIndex
CREATE INDEX "Attachment_rfqId_idx" ON "Attachment"("rfqId");

-- CreateIndex
CREATE INDEX "Attachment_fupaId_idx" ON "Attachment"("fupaId");
