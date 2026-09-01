-- Purchasing hand-off and answer tracking for FUP A, mirroring what Rfq already
-- carries (sentToPurchasingAt, jawabanRfqDikirim/jawabanRfqAt).
-- AlterTable
ALTER TABLE "Fupa" ADD COLUMN     "sentToPurchasingAt" TIMESTAMP(3),
                   ADD COLUMN     "jawabanFupaDikirim" BOOLEAN NOT NULL DEFAULT false,
                   ADD COLUMN     "jawabanFupaAt" TIMESTAMP(3);

-- Backfill the hand-off stamp for rows already handed over: `status` moved to
-- 'Terkirim' at that moment, so updatedAt is the closest evidence we have.
-- Left NULL for drafts, which were never sent.
UPDATE "Fupa" SET "sentToPurchasingAt" = "updatedAt" WHERE "status" <> 'Draft';

-- Rows that already carry a written Purchasing reply count as answered.
UPDATE "Fupa"
SET "jawabanFupaDikirim" = true, "jawabanFupaAt" = "updatedAt"
WHERE "purchJawaban" IS NOT NULL AND btrim("purchJawaban") <> '';
