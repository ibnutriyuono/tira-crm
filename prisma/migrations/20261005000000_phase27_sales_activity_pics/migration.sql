-- Phase 27: PIC + jabatan per aktivitas harian (bisa lebih dari satu).
-- Baris lama mendapat [] dan tetap terbaca; validasi "minimal satu PIC"
-- hanya berlaku untuk simpan/ubah berikutnya.
ALTER TABLE "SalesActivity" ADD COLUMN "pics" JSONB NOT NULL DEFAULT '[]';
