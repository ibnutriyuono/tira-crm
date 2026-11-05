-- Bahasa permintaan harga ke vendor (id | en).
ALTER TABLE "Quotation" ADD COLUMN "lang" TEXT NOT NULL DEFAULT 'id';
