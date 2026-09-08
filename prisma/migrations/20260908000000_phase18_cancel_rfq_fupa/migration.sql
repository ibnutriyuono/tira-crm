-- Cancelling an RFQ / FUP A. The row is kept and keeps showing in the lists
-- with a "Dibatalkan" status plus its reason — deliberately not a delete, so
-- the history stays readable and the cancellation can be undone.
-- AlterTable
ALTER TABLE "Rfq"  ADD COLUMN "cancelledAt" TIMESTAMP(3),
                   ADD COLUMN "cancelledBy" TEXT,
                   ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Fupa" ADD COLUMN "cancelledAt" TIMESTAMP(3),
                   ADD COLUMN "cancelledBy" TEXT,
                   ADD COLUMN "cancelReason" TEXT;
