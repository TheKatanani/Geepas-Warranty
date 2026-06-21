/*
  Warnings:

  - You are about to drop the `Warranty` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Warranty";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "WarrantyRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "purchaseDate" DATETIME NOT NULL,
    "invoiceNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WarrantyProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registrationId" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT NOT NULL,
    "sku" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WarrantyProduct_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "WarrantyRegistration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerReward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

-- CreateTable
CREATE TABLE "SMSLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "registrationId" TEXT,
    "rewardId" TEXT,
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "smsSentAt" DATETIME,
    "smsProviderResponse" TEXT,
    CONSTRAINT "SMSLog_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "WarrantyRegistration" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SMSLog_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "CustomerReward" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WarrantyRegistration_shop_idx" ON "WarrantyRegistration"("shop");

-- CreateIndex
CREATE INDEX "WarrantyRegistration_phone_idx" ON "WarrantyRegistration"("phone");

-- CreateIndex
CREATE INDEX "WarrantyProduct_registrationId_idx" ON "WarrantyProduct"("registrationId");

-- CreateIndex
CREATE INDEX "CustomerReward_shop_idx" ON "CustomerReward"("shop");

-- CreateIndex
CREATE INDEX "CustomerReward_phone_idx" ON "CustomerReward"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReward_shop_phone_rewardType_key" ON "CustomerReward"("shop", "phone", "rewardType");

-- CreateIndex
CREATE INDEX "SMSLog_registrationId_idx" ON "SMSLog"("registrationId");

-- CreateIndex
CREATE INDEX "SMSLog_rewardId_idx" ON "SMSLog"("rewardId");
