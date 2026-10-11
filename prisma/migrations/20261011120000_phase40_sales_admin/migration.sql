-- Role Admin Sales (satu cabang) + tanggal/nomor faktur pada prospek.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'salesadmin';

ALTER TABLE "Prospect" ADD COLUMN "tglFaktur" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "noFaktur" TEXT;
