-- AlterTable
ALTER TABLE "Rfq" ADD COLUMN     "jawabanRfqAt" TIMESTAMP(3),
ADD COLUMN     "jawabanRfqDikirim" BOOLEAN NOT NULL DEFAULT false;
