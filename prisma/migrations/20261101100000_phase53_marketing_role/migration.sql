-- Role Product & Marketing + lead dari Marketing di prospek.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'marketing';
ALTER TABLE "Prospect" ADD COLUMN "leadSource" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "leadBy" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "leadById" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "leadAt" TIMESTAMP(3);
