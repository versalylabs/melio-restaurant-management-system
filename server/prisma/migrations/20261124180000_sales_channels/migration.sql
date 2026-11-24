-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'POS',
ADD COLUMN     "commissionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "channelCommissions" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "whatsappNumber" TEXT;

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_token_key" ON "payment_links"("token");

-- CreateIndex
CREATE INDEX "payment_links_saleId_idx" ON "payment_links"("saleId");

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Orders placed on the website so far are website orders.
UPDATE "orders" SET "channel" = 'WEBSITE' WHERE "id" IN (SELECT "saleId" FROM "online_orders");
