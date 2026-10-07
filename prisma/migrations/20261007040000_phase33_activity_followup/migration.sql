-- Phase 33: jadwal & realisasi follow-up otomatis masuk Aktivitas Harian.
-- status: "selesai" (sudah dilakukan, dihitung KPI) | "rencana" (jadwal).
-- sumber: null = isian manual, "followup" = otomatis dari Follow-up WhatsApp.
ALTER TABLE "SalesActivity" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'selesai';
ALTER TABLE "SalesActivity" ADD COLUMN "sumber" TEXT;
CREATE INDEX "SalesActivity_prospectId_status_idx" ON "SalesActivity"("prospectId", "status");
