-- Audit Kelola User: pembuat akun & login terakhir.
ALTER TABLE "User" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdById" TEXT, ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Pembuat akun dari Log Aktivitas (entri "Menambah user" paling awal).
UPDATE "User" u SET "createdBy" = a."actorName", "createdById" = a."userId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "actorName", "userId"
  FROM "ActivityLog"
  WHERE "entity" = 'user' AND "action" = 'create' AND "entityId" IS NOT NULL
  ORDER BY "entityId", "createdAt" ASC
) a
WHERE a."entityId" = u."id" AND u."createdBy" IS NULL;

-- Login terakhir dari Log Aktivitas.
UPDATE "User" u SET "lastLoginAt" = l.at
FROM (
  SELECT "userId", MAX("createdAt") AS at FROM "ActivityLog"
  WHERE "action" = 'login' AND "userId" IS NOT NULL GROUP BY "userId"
) l
WHERE l."userId" = u."id";
