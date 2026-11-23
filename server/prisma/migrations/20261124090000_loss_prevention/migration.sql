-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountApprovedBy" TEXT,
ADD COLUMN     "servedBy" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refundApprovedBy" TEXT,
ADD COLUMN     "refundedBy" TEXT;

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "cardVariance" DOUBLE PRECISION,
ADD COLUMN     "declaredCard" DOUBLE PRECISION,
ADD COLUMN     "declaredMobileMoney" DOUBLE PRECISION,
ADD COLUMN     "expectedCard" DOUBLE PRECISION,
ADD COLUMN     "expectedMobileMoney" DOUBLE PRECISION,
ADD COLUMN     "mobileMoneyVariance" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "pinUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "void_records" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "saleItemId" TEXT,
    "itemName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "value" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "firedToKitchen" BOOLEAN NOT NULL DEFAULT true,
    "stockDeducted" BOOLEAN NOT NULL DEFAULT false,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "void_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "void_records_restaurantId_createdAt_idx" ON "void_records"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "void_records_branchId_createdAt_idx" ON "void_records"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "void_records_saleId_idx" ON "void_records"("saleId");

