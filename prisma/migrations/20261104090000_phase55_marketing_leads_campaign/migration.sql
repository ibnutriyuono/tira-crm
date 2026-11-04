-- Tonggak respons cabang atas lead Marketing.
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "leadAssignedAt" TIMESTAMP(3);
ALTER TABLE "Prospect" ADD COLUMN IF NOT EXISTS "leadQuotedAt" TIMESTAMP(3);

-- Lead lama: Sales yang ditunjuk Marketing saat membuat lead dihitung ditugaskan saat itu juga.
UPDATE "Prospect" SET "leadAssignedAt" = "leadAt"
WHERE "leadAt" IS NOT NULL AND "leadAssignedAt" IS NULL AND COALESCE("se", '') <> '' AND "status" <= 1;

-- Kampanye email Marketing.
CREATE TABLE IF NOT EXISTS "Campaign" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "filter" JSONB NOT NULL DEFAULT '{}',
    "targets" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failed" JSONB NOT NULL DEFAULT '[]',
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Campaign_sentAt_idx" ON "Campaign"("sentAt");
