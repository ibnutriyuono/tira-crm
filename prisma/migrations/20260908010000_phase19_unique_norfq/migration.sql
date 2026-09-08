-- Unique No. RFQ. NULL is exempt — Postgres allows many NULLs in a unique
-- index — so historical rows without a number are unaffected.
--
-- This migration FAILS if two rows already share a noRfq. Run the checker
-- first, on the target database:
--     npx tsx prisma/check-duplicate-rfq.ts          (report only)
--     npx tsx prisma/check-duplicate-rfq.ts --fix    (suffix the duplicates)
-- CreateIndex
CREATE UNIQUE INDEX "Rfq_noRfq_key" ON "Rfq"("noRfq");
