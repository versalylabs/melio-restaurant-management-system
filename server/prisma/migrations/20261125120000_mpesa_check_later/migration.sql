-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT,
ADD COLUMN     "verifyStatus" TEXT;

-- CreateIndex
CREATE INDEX "payments_restaurantId_verifyStatus_idx" ON "payments"("restaurantId", "verifyStatus");

