-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "mpesaRegisteredAt" TIMESTAMP(3),
ADD COLUMN     "mpesaShortcode" TEXT,
ADD COLUMN     "mpesaShortcodeType" TEXT,
ADD COLUMN     "mpesaCallbackToken" TEXT;

-- CreateTable
CREATE TABLE "mpesa_transactions" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "shortcode" TEXT NOT NULL,
    "transId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "transTime" TIMESTAMP(3) NOT NULL,
    "msisdn" TEXT,
    "firstName" TEXT,
    "billRef" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mpesa_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_transId_key" ON "mpesa_transactions"("transId");

-- CreateIndex
CREATE INDEX "mpesa_transactions_branchId_transTime_idx" ON "mpesa_transactions"("branchId", "transTime");

-- CreateIndex
CREATE INDEX "mpesa_transactions_restaurantId_paymentId_idx" ON "mpesa_transactions"("restaurantId", "paymentId");

-- AddForeignKey
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "branches_mpesaShortcode_key" ON "branches"("mpesaShortcode");

-- CreateIndex
CREATE UNIQUE INDEX "branches_mpesaCallbackToken_key" ON "branches"("mpesaCallbackToken");
