import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRaw`DROP TABLE IF EXISTS order_status_history`;
  await prisma.$executeRaw`DROP TABLE IF EXISTS order_item_modifiers`;
  await prisma.$executeRaw`DROP TABLE IF EXISTS order_items`;
  await prisma.$executeRaw`DROP TABLE IF EXISTS orders`;
  await prisma.$executeRaw`DROP TABLE IF EXISTS order_counters`;

  await prisma.$executeRaw`
    CREATE TABLE "orders" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "restaurantId" TEXT NOT NULL,
        "branchId" TEXT NOT NULL,
        "orderNumber" TEXT NOT NULL,
        "orderType" TEXT NOT NULL DEFAULT 'DINE_IN',
        "tableId" TEXT,
        "customerId" TEXT,
        "customerName" TEXT,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "subtotal" REAL NOT NULL,
        "discountAmount" REAL NOT NULL DEFAULT 0,
        "discountReason" TEXT,
        "discountAppliedBy" TEXT,
        "taxAmount" REAL NOT NULL DEFAULT 0,
        "serviceChargeAmount" REAL NOT NULL DEFAULT 0,
        "totalAmount" REAL NOT NULL,
        "notes" TEXT,
        "createdBy" TEXT NOT NULL,
        "completedAt" DATETIME,
        "cancelledAt" DATETIME,
        "cancelReason" TEXT,
        "cancelledBy" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE "order_items" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "saleId" TEXT NOT NULL,
        "menuItemId" TEXT NOT NULL,
        "itemNameSnapshot" TEXT NOT NULL,
        "unitPrice" REAL NOT NULL,
        "quantity" INTEGER NOT NULL,
        "subtotal" REAL NOT NULL,
        "notes" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "order_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE "order_item_modifiers" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "saleItemId" TEXT NOT NULL,
        "modifierOptionId" TEXT NOT NULL,
        "optionNameSnapshot" TEXT NOT NULL,
        "priceAdjustment" REAL NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "order_item_modifiers_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "order_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE "order_status_history" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "saleId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "notes" TEXT,
        "changedBy" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "order_status_history_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE "order_counters" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "restaurantId" TEXT NOT NULL,
        "branchId" TEXT NOT NULL,
        "lastNumber" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "order_counters_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`CREATE UNIQUE INDEX "orders_branchId_orderNumber_key" ON "orders"("branchId", "orderNumber")`;
  await prisma.$executeRaw`CREATE INDEX "orders_restaurantId_branchId_status_idx" ON "orders"("restaurantId", "branchId", "status")`;
  await prisma.$executeRaw`CREATE INDEX "orders_restaurantId_createdAt_idx" ON "orders"("restaurantId", "createdAt")`;
  await prisma.$executeRaw`CREATE INDEX "order_items_saleId_idx" ON "order_items"("saleId")`;
  await prisma.$executeRaw`CREATE INDEX "order_item_modifiers_saleItemId_idx" ON "order_item_modifiers"("saleItemId")`;
  await prisma.$executeRaw`CREATE INDEX "order_status_history_saleId_idx" ON "order_status_history"("saleId")`;
  await prisma.$executeRaw`CREATE UNIQUE INDEX "order_counters_restaurantId_branchId_key" ON "order_counters"("restaurantId", "branchId")`;

  console.log('Order tables recreated successfully');
  await prisma.$disconnect();
}

main();
