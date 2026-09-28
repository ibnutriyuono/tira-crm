-- No. PO/kontrak dari customer. Nullable di database -- baris lama yang
-- sudah lama berstatus PO/DO tidak punya nomor ini tercatat, dan
-- mewajibkannya di sini akan menggagalkan migrasi. Kewajiban isinya
-- ditegakkan di aplikasi (POST/PUT/PATCH /api/prospects) hanya untuk
-- perubahan status ke depan, bukan lewat constraint kolom.

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "noPo" TEXT;
