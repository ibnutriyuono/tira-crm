-- Jeda akun user: tidak bisa login tetapi akun & datanya tetap ada.
ALTER TABLE "User" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "User" ADD COLUMN "pausedBy" TEXT;
