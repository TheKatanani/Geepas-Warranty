/*
  Warnings:

  - You are about to drop the column `invoiceUrl` on the `Warranty` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Warranty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productId" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" DATETIME NOT NULL,
    "invoiceNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Warranty" ("createdAt", "email", "id", "name", "phone", "productId", "productName", "purchaseDate", "serialNumber", "shop", "status", "updatedAt") SELECT "createdAt", "email", "id", "name", "phone", "productId", "productName", "purchaseDate", "serialNumber", "shop", "status", "updatedAt" FROM "Warranty";
DROP TABLE "Warranty";
ALTER TABLE "new_Warranty" RENAME TO "Warranty";
CREATE INDEX "Warranty_shop_idx" ON "Warranty"("shop");
CREATE INDEX "Warranty_serialNumber_idx" ON "Warranty"("serialNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
