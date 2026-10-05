-- Daftar PIC (contact person) per customer: nama, jabatan, telepon, email,
-- dan tanda PIC utama. Nullable -- baris lama yang hanya punya pic/phone/email
-- tunggal tetap tidak tersentuh; API mencerminkan PIC utama dari daftar ini
-- ke kolom lama tersebut setiap kali disimpan, supaya pemanggil yang belum
-- diupdate ke `pics` tetap mendapat data yang benar.
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "pics" JSONB;
