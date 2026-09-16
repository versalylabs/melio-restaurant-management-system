CREATE TABLE "online_orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "fulfillmentType" TEXT NOT NULL DEFAULT 'PICKUP',
  "deliveryAddress" TEXT,
  "contactPhone" TEXT,
  "contactEmail" TEXT,
  "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
  "paymentState" TEXT NOT NULL DEFAULT 'UNPAID',
  "trackingToken" TEXT NOT NULL,
  "customerNotes" TEXT,
  "placedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "online_orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "online_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "online_orders_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "online_orders_saleId_key" ON "online_orders"("saleId");
CREATE UNIQUE INDEX "online_orders_trackingToken_key" ON "online_orders"("trackingToken");
CREATE INDEX "online_orders_restaurantId_branchId_placedAt_idx" ON "online_orders"("restaurantId", "branchId", "placedAt");
CREATE INDEX "online_orders_trackingToken_idx" ON "online_orders"("trackingToken");
