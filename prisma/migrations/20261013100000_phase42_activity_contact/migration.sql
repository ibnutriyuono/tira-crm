-- Aktivitas Harian: saluran, hasil kontak, langkah berikutnya, lokasi, rencana follow-up.
ALTER TABLE "SalesActivity" ADD COLUMN "kanal" TEXT;
ALTER TABLE "SalesActivity" ADD COLUMN "hasil" TEXT;
ALTER TABLE "SalesActivity" ADD COLUMN "langkah" TEXT;
ALTER TABLE "SalesActivity" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "SalesActivity" ADD COLUMN "lng" DOUBLE PRECISION;
ALTER TABLE "SalesActivity" ADD COLUMN "akurasi" DOUBLE PRECISION;
ALTER TABLE "SalesActivity" ADD COLUMN "followUpId" TEXT;
