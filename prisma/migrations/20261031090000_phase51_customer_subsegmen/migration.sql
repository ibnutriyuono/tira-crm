-- Segmen & sub-segmen customer (lib/customer-segments.ts).
ALTER TABLE "Customer" ADD COLUMN "subSegmen" TEXT;

-- Segmen lama (daftar datar) dipetakan ke struktur baru.
UPDATE "Customer" SET "segmen" = 'Pertambangan' WHERE "segmen" = 'Tambang';
UPDATE "Customer" SET "segmen" = 'Semen & bahan bangunan', "subSegmen" = 'Pabrik semen' WHERE "segmen" = 'Semen';
UPDATE "Customer" SET "segmen" = 'Agro' WHERE "segmen" = 'Sawit & agro';
UPDATE "Customer" SET "segmen" = 'Energi' WHERE "segmen" IN ('Energi & pembangkit', 'Migas & petrokimia');
UPDATE "Customer" SET "segmen" = 'Supplier' WHERE "segmen" IN ('Fabrikator / bengkel', 'Distributor / trader');
UPDATE "Customer" SET "segmen" = 'Infrastruktur', "subSegmen" = 'Konstruksi umum' WHERE "segmen" = 'Konstruksi';
UPDATE "Customer" SET "segmen" = 'Others' WHERE "segmen" = 'Lainnya';
