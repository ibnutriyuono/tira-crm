-- Profil customer: segmen, aplikasi pemakaian, potensi per tahun, kompetitor.
ALTER TABLE "Customer" ADD COLUMN "segmen" TEXT;
ALTER TABLE "Customer" ADD COLUMN "aplikasi" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Customer" ADD COLUMN "potensi" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "kompetitor" TEXT;
CREATE INDEX "Customer_segmen_idx" ON "Customer"("segmen");
