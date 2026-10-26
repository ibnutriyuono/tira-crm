-- Phase 49: profil vendor & AVL, minta harga ke vendor, dokumen vendor,
-- Tugas Kunjungan dan Rencana Kunjungan Mingguan.

-- Vendor
ALTER TABLE "Vendor" ADD COLUMN "tipe" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "asal" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "negara" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "mataUang" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "incoterm" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "produk" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Vendor" ADD COLUMN "tebalMin" DOUBLE PRECISION;
ALTER TABLE "Vendor" ADD COLUMN "tebalMax" DOUBLE PRECISION;
ALTER TABLE "Vendor" ADD COLUMN "moq" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "leadTime" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "syaratBayar" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "pics" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Vendor" ADD COLUMN "statusAvl" TEXT NOT NULL DEFAULT 'aktif';
ALTER TABLE "Vendor" ADD COLUMN "statusAlasan" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "statusOleh" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "statusAt" TIMESTAMP(3);
ALTER TABLE "Vendor" ADD COLUMN "dokumen" JSONB NOT NULL DEFAULT '[]';

-- Quotation (permintaan harga ke vendor)
ALTER TABLE "Quotation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'menunggu';
ALTER TABLE "Quotation" ADD COLUMN "tenggat" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Quotation" ADD COLUMN "currency" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "sentAt" TIMESTAMP(3);
ALTER TABLE "Quotation" ADD COLUMN "reminders" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Quotation" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
ALTER TABLE "Quotation" ADD COLUMN "balasAt" TIMESTAMP(3);
ALTER TABLE "Quotation" ADD COLUMN "token" TEXT;
-- Penawaran vendor lama yang sudah berharga dianggap sudah dibalas.
UPDATE "Quotation" SET "status" = 'dibalas' WHERE "harga" > 0;

-- Attachment: dokumen vendor
ALTER TABLE "Attachment" ADD COLUMN "vendorId" TEXT;
CREATE INDEX "Attachment_vendorId_idx" ON "Attachment"("vendorId");

-- Tugas Kunjungan
CREATE TABLE "VisitTask" (
    "id" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "customerId" TEXT,
    "prospectId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "assigneeName" TEXT NOT NULL,
    "se" TEXT,
    "cabang" TEXT,
    "reg" INTEGER,
    "assignedById" TEXT NOT NULL,
    "assignedByName" TEXT NOT NULL,
    "assignedByRole" TEXT NOT NULL,
    "tujuan" TEXT NOT NULL,
    "catatan" TEXT,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ditugaskan',
    "reschedules" JSONB NOT NULL DEFAULT '[]',
    "activityId" TEXT,
    "hasil" TEXT,
    "reportedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "saran" TEXT,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VisitTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VisitTask_assigneeId_status_idx" ON "VisitTask"("assigneeId", "status");
CREATE INDEX "VisitTask_cabang_status_idx" ON "VisitTask"("cabang", "status");
CREATE INDEX "VisitTask_dueDate_idx" ON "VisitTask"("dueDate");

-- Rencana Kunjungan Mingguan
CREATE TABLE "VisitPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "se" TEXT,
    "cabang" TEXT,
    "reg" INTEGER,
    "weekStart" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VisitPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitPlan_userId_weekStart_key" ON "VisitPlan"("userId", "weekStart");
CREATE INDEX "VisitPlan_cabang_weekStart_idx" ON "VisitPlan"("cabang", "weekStart");

-- Masalah dilaporkan Purchasing (dari RFQ / FUP A / PO Indent)
ALTER TABLE "ProspectIssue" ADD COLUMN "sumber" TEXT;
ALTER TABLE "ProspectIssue" ADD COLUMN "docJenis" TEXT;
ALTER TABLE "ProspectIssue" ADD COLUMN "docId" TEXT;
ALTER TABLE "ProspectIssue" ADD COLUMN "noDoc" TEXT;
