-- Phase 31: QCD terstruktur (dropdown) + faktor penentu. Kolom teks lama
-- (qcdQuality/qcdCost/qcdDelivery) tetap dipakai sebagai keterangan.
ALTER TABLE "Prospect" ADD COLUMN "qcdQualityLevel" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "qcdCostLevel" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "qcdDeliveryLevel" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "qcdFaktor" TEXT;
