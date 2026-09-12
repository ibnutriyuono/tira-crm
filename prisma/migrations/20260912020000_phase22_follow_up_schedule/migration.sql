-- Manual follow-up scheduling on a prospect. Stored as TEXT "YYYY-MM-DD" to
-- match the other user-entered dates in this schema (tglMasuk, tglClosing):
-- these are calendar dates typed by Sales, never instants, so a timestamp
-- column would invite timezone drift on a date nobody ever meant as one.
--
-- Distinct from Aging, which is derived from statusChangedAt. The Follow-up
-- dashboard unions the two: what someone scheduled, plus what has gone quiet
-- on its own.

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "followUpAt"   TEXT,
                       ADD COLUMN "followUpNote" TEXT;

-- The dashboard's primary read is "everything due, oldest first".
CREATE INDEX "Prospect_followUpAt_idx" ON "Prospect"("followUpAt");
