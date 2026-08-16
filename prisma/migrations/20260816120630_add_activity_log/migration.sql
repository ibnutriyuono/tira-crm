-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('login', 'login_failed', 'logout', 'create', 'update', 'status_change', 'delete', 'import', 'export', 'restore');

-- CreateEnum
CREATE TYPE "ActivityEntity" AS ENUM ('prospect', 'customer', 'rfq', 'user', 'setting', 'database', 'session');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "role" "Role",
    "actorCabang" TEXT,
    "actorReg" INTEGER,
    "action" "ActivityAction" NOT NULL,
    "entity" "ActivityEntity" NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "ip" TEXT,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_entity_entityId_idx" ON "ActivityLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");

-- CreateIndex
CREATE INDEX "ActivityLog_actorCabang_idx" ON "ActivityLog"("actorCabang");

-- CreateIndex
CREATE INDEX "ActivityLog_actorReg_idx" ON "ActivityLog"("actorReg");
