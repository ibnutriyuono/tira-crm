-- Tanda tangan user untuk surat penawaran (Akun Saya).
ALTER TABLE "User" ADD COLUMN "signatureAt" TIMESTAMP(3);

CREATE TABLE "UserSignature" (
    "userId" TEXT NOT NULL,
    "png" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSignature_pkey" PRIMARY KEY ("userId")
);

-- Surat Penawaran tercatat di Aktivitas Harian: nomor surat (satu surat = satu baris).
ALTER TABLE "SalesActivity" ADD COLUMN "refNo" TEXT;
CREATE INDEX "SalesActivity_sumber_refNo_idx" ON "SalesActivity"("sumber", "refNo");
