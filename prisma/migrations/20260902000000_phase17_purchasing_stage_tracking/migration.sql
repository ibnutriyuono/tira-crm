-- Five-stage automatic Purchasing status: adds the "opened by Purchasing"
-- stamp (stage 2 "Diterima") and the manual "No Quote" flag (stage 5).
-- AlterTable
ALTER TABLE "Rfq"  ADD COLUMN "openedByPurchasingAt" TIMESTAMP(3),
                   ADD COLUMN "noQuote" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Fupa" ADD COLUMN "openedByPurchasingAt" TIMESTAMP(3),
                   ADD COLUMN "noQuote" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: stage 2 used to be inferred from "Purchasing has done something"
-- (purchStatus moved, or internal notes written). Without this, every document
-- Purchasing already worked on would read as "1. Baru" until someone reopened
-- it. updatedAt is the closest evidence of when that work happened.
UPDATE "Rfq"
SET "openedByPurchasingAt" = "updatedAt"
WHERE "openedByPurchasingAt" IS NULL
  AND ("purchStatus" > 0 OR btrim(COALESCE("purchNotes", '')) <> '');

UPDATE "Fupa"
SET "openedByPurchasingAt" = "updatedAt"
WHERE "openedByPurchasingAt" IS NULL
  AND ("purchStatus" > 0 OR btrim(COALESCE("purchNotes", '')) <> '');
