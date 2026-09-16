-- Phase 21: Discounts, taxes and promotions (additive migration)

ALTER TABLE "orders" ADD COLUMN "promotionId" TEXT;
CREATE INDEX IF NOT EXISTS "orders_promotionId_idx" ON "orders"("promotionId");

CREATE TABLE "promotions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "value" REAL NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'ORDER',
    "menuItemId" TEXT,
    "customerId" TEXT,
    "minSubtotal" REAL NOT NULL DEFAULT 0,
    "maxDiscountAmount" REAL,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "startTime" TEXT,
    "endTime" TEXT,
    "happyHour" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "promotions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "promotions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "promotions_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "promotions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "promotions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "promotions_restaurantId_code_key" ON "promotions"("restaurantId", "code");
CREATE INDEX "promotions_restaurantId_active_idx" ON "promotions"("restaurantId", "active");
CREATE INDEX "promotions_restaurantId_branchId_idx" ON "promotions"("restaurantId", "branchId");
