-- Kontrak harga / qty tahunan customer: item (grade / tebal / dimensi / non-katalog),
-- realisasi (item prospek terhubung + saldo awal), dan riwayat.
CREATE TABLE "Kontrak" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "noCustomer" TEXT,
    "jenis" TEXT NOT NULL DEFAULT 'hq',
    "skemaHarga" TEXT NOT NULL DEFAULT 'tetap',
    "skemaCatatan" TEXT,
    "groupId" TEXT,
    "grupNama" TEXT NOT NULL,
    "entitas" JSONB NOT NULL DEFAULT '[]',
    "cabangs" JSONB NOT NULL DEFAULT '[]',
    "cabang" TEXT NOT NULL,
    "reg" INTEGER,
    "tglMulai" TEXT NOT NULL,
    "tglAkhir" TEXT NOT NULL,
    "top" TEXT,
    "franco" TEXT,
    "catatan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "level" TEXT,
    "maxDiscount" DOUBLE PRECISION,
    "butuhPasokan" BOOLEAN NOT NULL DEFAULT false,
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "prevId" TEXT,
    "prospectId" TEXT,
    "remindersSent" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Kontrak_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Kontrak_nomor_key" ON "Kontrak"("nomor");
CREATE INDEX "Kontrak_status_idx" ON "Kontrak"("status");
CREATE INDEX "Kontrak_cabang_idx" ON "Kontrak"("cabang");
CREATE INDEX "Kontrak_groupId_idx" ON "Kontrak"("groupId");

CREATE TABLE "KontrakItem" (
    "id" TEXT NOT NULL,
    "kontrakId" TEXT NOT NULL,
    "urut" INTEGER NOT NULL DEFAULT 0,
    "cakupan" TEXT NOT NULL DEFAULT 'grade',
    "grade" TEXT,
    "gradeKey" TEXT,
    "bentuk" TEXT,
    "tebalMin" DOUBLE PRECISION,
    "tebalMax" DOUBLE PRECISION,
    "dims" JSONB NOT NULL DEFAULT '[]',
    "nama" TEXT,
    "spesifikasi" TEXT,
    "partNo" TEXT,
    "kategori" TEXT,
    "satuan" TEXT NOT NULL DEFAULT 'kg',
    "harga" DOUBLE PRECISION,
    "acuan" JSONB NOT NULL DEFAULT '[]',
    "qtyKomitmen" DOUBLE PRECISION,
    "materialBaru" BOOLEAN NOT NULL DEFAULT false,
    "vendorBerlaku" TEXT,
    "saldoQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saldoNilai" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saldoTgl" TEXT,
    "saldoKet" TEXT,
    CONSTRAINT "KontrakItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KontrakItem_kontrakId_idx" ON "KontrakItem"("kontrakId");
ALTER TABLE "KontrakItem" ADD CONSTRAINT "KontrakItem_kontrakId_fkey" FOREIGN KEY ("kontrakId") REFERENCES "Kontrak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KontrakLink" (
    "id" TEXT NOT NULL,
    "kontrakId" TEXT NOT NULL,
    "kontrakItemId" TEXT NOT NULL,
    "dimId" TEXT,
    "prospectId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KontrakLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KontrakLink_prospectId_itemId_key" ON "KontrakLink"("prospectId", "itemId");
CREATE INDEX "KontrakLink_kontrakId_idx" ON "KontrakLink"("kontrakId");
CREATE INDEX "KontrakLink_prospectId_idx" ON "KontrakLink"("prospectId");
ALTER TABLE "KontrakLink" ADD CONSTRAINT "KontrakLink_kontrakId_fkey" FOREIGN KEY ("kontrakId") REFERENCES "Kontrak"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KontrakLink" ADD CONSTRAINT "KontrakLink_kontrakItemId_fkey" FOREIGN KEY ("kontrakItemId") REFERENCES "KontrakItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KontrakLog" (
    "id" TEXT NOT NULL,
    "kontrakId" TEXT NOT NULL,
    "aksi" TEXT NOT NULL,
    "ket" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KontrakLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KontrakLog_kontrakId_idx" ON "KontrakLog"("kontrakId");
ALTER TABLE "KontrakLog" ADD CONSTRAINT "KontrakLog_kontrakId_fkey" FOREIGN KEY ("kontrakId") REFERENCES "Kontrak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Log Aktivitas: entitas kontrak.
ALTER TYPE "ActivityEntity" ADD VALUE IF NOT EXISTS 'kontrak';
