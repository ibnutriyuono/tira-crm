-- Riwayat item prospek: penawaran -> PO -> pengiriman (lihat src/lib/item-flow.ts).
CREATE TABLE "ProspectItemEvent" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tgl" TEXT,
    "type" TEXT NOT NULL,
    "docNo" TEXT,
    "title" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "userId" TEXT,
    "actorName" TEXT NOT NULL,

    CONSTRAINT "ProspectItemEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectItemEvent_prospectId_createdAt_idx" ON "ProspectItemEvent"("prospectId", "createdAt");
CREATE INDEX "ProspectItemEvent_type_tgl_idx" ON "ProspectItemEvent"("type", "tgl");
