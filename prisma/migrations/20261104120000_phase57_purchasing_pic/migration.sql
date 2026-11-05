-- PIC Purchasing yang membuka (Diterima) dan menjawab (Dijawab) RFQ / FUP A.
ALTER TABLE "Rfq" ADD COLUMN "openedById" TEXT, ADD COLUMN "openedByName" TEXT, ADD COLUMN "jawabanById" TEXT, ADD COLUMN "jawabanByName" TEXT;
ALTER TABLE "Fupa" ADD COLUMN "openedById" TEXT, ADD COLUMN "openedByName" TEXT, ADD COLUMN "jawabanById" TEXT, ADD COLUMN "jawabanByName" TEXT;

-- Isi data lama: penjawab = pelaku log terakhir yang mengirim / mengisi jawaban.
UPDATE "Rfq" r SET "jawabanById" = a."userId", "jawabanByName" = a."actorName"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "userId", "actorName"
  FROM "ActivityLog"
  WHERE "entity" = 'rfq' AND ("summary" LIKE 'Mengirim jawaban RFQ%' OR "summary" LIKE 'Mengisi jawaban Purchasing%')
  ORDER BY "entityId", ("summary" LIKE 'Mengirim jawaban RFQ%') DESC, "createdAt" DESC
) a
WHERE a."entityId" = r."id" AND r."jawabanByName" IS NULL;

UPDATE "Fupa" f SET "jawabanById" = a."userId", "jawabanByName" = a."actorName"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "userId", "actorName"
  FROM "ActivityLog"
  WHERE "entity" = 'fupa' AND "summary" LIKE 'Mengisi catatan/jawaban Purchasing%'
  ORDER BY "entityId", "createdAt" ASC
) a
WHERE a."entityId" = f."id" AND f."jawabanFupaDikirim" = true AND f."jawabanByName" IS NULL;
