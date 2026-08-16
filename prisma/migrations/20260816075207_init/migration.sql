-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'gm', 'rm', 'bm', 'sales');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "se" TEXT,
    "cabang" TEXT,
    "reg" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cabang" TEXT,
    "pic" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "reg" INTEGER,
    "cabang" TEXT,
    "se" TEXT,
    "customer" TEXT NOT NULL,
    "phone" TEXT,
    "tglPenawaran" TEXT,
    "tglPO" TEXT,
    "tglDelivery" TEXT,
    "line" TEXT,
    "uraian" TEXT,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materials" JSONB NOT NULL,
    "kondisiStock" TEXT,
    "keterangan" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "penawaranTerkirim" BOOLEAN NOT NULL DEFAULT false,
    "qcdQuality" TEXT,
    "qcdCost" TEXT,
    "qcdDelivery" TEXT,
    "qcdKompetitor" TEXT,
    "qcdCatatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "noRfq" TEXT,
    "tglRfq" TEXT,
    "cabang" TEXT,
    "customer" TEXT,
    "requestedBy" TEXT,
    "prospectId" TEXT,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Prospect_status_idx" ON "Prospect"("status");

-- CreateIndex
CREATE INDEX "Prospect_cabang_idx" ON "Prospect"("cabang");

-- CreateIndex
CREATE INDEX "Prospect_se_idx" ON "Prospect"("se");

-- CreateIndex
CREATE INDEX "Prospect_reg_idx" ON "Prospect"("reg");
