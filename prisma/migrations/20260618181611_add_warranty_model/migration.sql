-- CreateTable
CREATE TABLE "Warranty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productId" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" DATETIME NOT NULL,
    "invoiceUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Warranty_shop_idx" ON "Warranty"("shop");

-- CreateIndex
CREATE INDEX "Warranty_serialNumber_idx" ON "Warranty"("serialNumber");
