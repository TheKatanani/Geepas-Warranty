-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyRegistration" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "invoiceNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarrantyRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyProduct" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT NOT NULL,
    "sku" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WarrantyProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReward" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "CustomerReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SMSLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "registrationId" TEXT,
    "rewardId" TEXT,
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "smsSentAt" TIMESTAMP(3),
    "smsProviderResponse" TEXT,

    CONSTRAINT "SMSLog_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "WarrantyProduct" ADD CONSTRAINT "WarrantyProduct_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "WarrantyRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SMSLog" ADD CONSTRAINT "SMSLog_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "WarrantyRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SMSLog" ADD CONSTRAINT "SMSLog_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "CustomerReward"("id") ON DELETE SET NULL ON UPDATE CASCADE;
