-- Notifikasi email: email & pengaturan per user, penanda terkirim, log email.
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "notifPrefs" JSONB NOT NULL DEFAULT '{}';
-- Akun Saya: wajib ganti password setelah direset Admin.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN "emailedAt" TIMESTAMP(3);

CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailLog_userId_kind_createdAt_idx" ON "EmailLog"("userId", "kind", "createdAt");
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");
