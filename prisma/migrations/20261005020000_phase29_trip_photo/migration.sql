-- Phase 29: foto kunjungan per perjalanan dinas. Uraian realisasi disimpan
-- di dalam VisitTrip.visits (JSON), jadi tidak butuh kolom baru.
CREATE TABLE "TripPhoto" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TripPhoto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TripPhoto_key_key" ON "TripPhoto"("key");
CREATE INDEX "TripPhoto_tripId_idx" ON "TripPhoto"("tripId");
