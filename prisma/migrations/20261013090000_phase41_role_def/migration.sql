-- Kelola Role: hak Lihat / Ubah / Hapus / Download per modul, role tambahan.
CREATE TABLE "RoleDef" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "perms" JSONB NOT NULL DEFAULT '{}',
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleDef_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "User" ADD COLUMN "customRole" TEXT;
