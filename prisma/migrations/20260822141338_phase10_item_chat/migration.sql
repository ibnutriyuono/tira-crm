-- CreateTable
CREATE TABLE "ItemMessage" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "role" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemRead" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemMessage_entity_entityId_createdAt_idx" ON "ItemMessage"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ItemRead_username_idx" ON "ItemRead"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ItemRead_username_entity_entityId_key" ON "ItemRead"("username", "entity", "entityId");
