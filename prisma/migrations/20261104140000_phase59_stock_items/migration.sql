-- Posisi stok gudang (upload manual Inventory Value Report Sage).
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "line" TEXT,
    "description" TEXT NOT NULL,
    "size" TEXT,
    "unit" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "hpp" DOUBLE PRECISION,
    "fsv" INTEGER,
    "ageDays" INTEGER,
    "locations" JSONB NOT NULL DEFAULT '{}',
    "grade" TEXT,
    "gradeKey" TEXT,
    "variant" TEXT,
    "bentuk" TEXT,
    "dim" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockItem_gradeKey_idx" ON "StockItem"("gradeKey");
