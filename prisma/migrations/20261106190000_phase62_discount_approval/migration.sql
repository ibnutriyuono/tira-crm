-- Persetujuan Surat Penawaran berdasarkan diskon dari harga jual Purchasing
-- (SE 5%, BM 10%, GM 15%, VP 20%). Pengajuan lama tetap tercatat sebagai margin.
ALTER TABLE "MarginApproval" ADD COLUMN "basis" TEXT NOT NULL DEFAULT 'margin';
ALTER TABLE "MarginApproval" ADD COLUMN "maxDiscount" DOUBLE PRECISION;
