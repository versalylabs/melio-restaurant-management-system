-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "inventoryDeductedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_tableId_status_idx" ON "orders"("tableId", "status");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_restaurantId_clientRequestId_key" ON "orders"("restaurantId", "clientRequestId");

-- CreateIndex
CREATE INDEX "payments_reference_idx" ON "payments"("reference");


-- Backfill: orders whose stock was already deducted (old code path) are marked,
-- so the new idempotent deduction never deducts them a second time.
UPDATE "orders" o
SET "inventoryDeductedAt" = COALESCE(o."completedAt", o."updatedAt")
WHERE o."inventoryDeductedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "stock_movements" m
    WHERE m."referenceId" = o."id" AND m."referenceType" = 'ORDER_DEDUCTION'
  );
