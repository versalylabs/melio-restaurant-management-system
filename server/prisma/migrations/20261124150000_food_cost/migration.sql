-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "targetFoodCostPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "stocktake_items" ADD COLUMN     "unitCost" DOUBLE PRECISION,
ADD COLUMN     "varianceValue" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ingredient_price_history" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "ingredientId" TEXT NOT NULL,
    "supplierId" TEXT,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "previousUnitCost" DOUBLE PRECISION,
    "reversedAt" TIMESTAMP(3),
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "totalPaid" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "referenceId" TEXT,
    "vendor" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredient_price_history_ingredientId_createdAt_idx" ON "ingredient_price_history"("ingredientId", "createdAt");

-- CreateIndex
CREATE INDEX "ingredient_price_history_restaurantId_createdAt_idx" ON "ingredient_price_history"("restaurantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ingredient_price_history" ADD CONSTRAINT "ingredient_price_history_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

