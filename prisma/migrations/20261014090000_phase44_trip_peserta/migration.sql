-- Perjalanan Dinas: peserta, dan kunjungan realisasi -> Aktivitas Harian
ALTER TABLE "VisitTrip" ADD COLUMN "pesertaIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "SalesActivity" ADD COLUMN "tripId" TEXT;
ALTER TABLE "SalesActivity" ADD COLUMN "tripVisitId" TEXT;
ALTER TABLE "SalesActivity" ADD COLUMN "pendamping" TEXT;
CREATE INDEX "SalesActivity_tripId_idx" ON "SalesActivity"("tripId");
