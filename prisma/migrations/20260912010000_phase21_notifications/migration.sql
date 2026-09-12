-- Persistent notification centre. One row per recipient rather than one
-- broadcast row shared by many: "mark as read" is then just setting readAt on
-- the reader's own row, with no separate read-receipts table.
--
-- userId is deliberately not a foreign key to User, matching the rest of this
-- schema (see ActivityLog) — a notification stays readable after the account
-- it belongs to is re-scoped, and deleting a user does not cascade away
-- history someone may still be looking at.

-- CreateTable
CREATE TABLE "Notification" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "entity"    TEXT NOT NULL,
    "entityId"  TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "readAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- The panel reads "my notifications, newest first" and "my unread count";
-- both indexes lead with userId so neither ever scans another user's rows.
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_readAt_idx"    ON "Notification"("userId", "readAt");
