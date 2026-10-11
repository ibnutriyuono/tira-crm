-- Key Account Management: grup customer, tier, tim (ketua/sekretaris/anggota), account plan.
ALTER TYPE "ActivityEntity" ADD VALUE IF NOT EXISTS 'customerGroup';

CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'monitor',
    "skor" DOUBLE PRECISION,
    "pola" TEXT,
    "segmen" TEXT,
    "homeCabang" TEXT,
    "supportCabang" JSONB NOT NULL DEFAULT '[]',
    "entities" JSONB NOT NULL DEFAULT '[]',
    "sponsor" TEXT,
    "ketuaId" TEXT,
    "sekretarisId" TEXT,
    "anggotaIds" JSONB NOT NULL DEFAULT '[]',
    "l12m" DOUBLE PRECISION,
    "growthYtd" DOUBLE PRECISION,
    "margin" DOUBLE PRECISION,
    "avg3y" DOUBLE PRECISION,
    "lastTrx" TEXT,
    "target" DOUBLE PRECISION,
    "reviewNext" TEXT,
    "notes" TEXT,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "tierHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerGroup_name_key" ON "CustomerGroup"("name");
CREATE INDEX "CustomerGroup_tier_idx" ON "CustomerGroup"("tier");
CREATE INDEX "CustomerGroup_ketuaId_idx" ON "CustomerGroup"("ketuaId");
