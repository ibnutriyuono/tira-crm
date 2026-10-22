-- Tanggal Lose Order (YYYY-MM-DD). Prospek Lose yang sudah ada diisi dari
-- tanggal pindah status (zona Asia/Jakarta).
ALTER TABLE "Prospect" ADD COLUMN "tglLose" TEXT;

UPDATE "Prospect"
SET "tglLose" = to_char(("statusChangedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
WHERE "status" = 6 AND "tglLose" IS NULL;
