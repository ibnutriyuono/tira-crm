-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "pic" TEXT,
    "wa" TEXT,
    "email" TEXT,
    "kategori" TEXT,
    "alamat" TEXT,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vendor_nama_idx" ON "Vendor"("nama");

-- CreateIndex
CREATE INDEX "Vendor_kategori_idx" ON "Vendor"("kategori");
