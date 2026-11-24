-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN     "marketingConsentBy" TEXT,
ADD COLUMN     "marketingConsentSource" TEXT,
ADD COLUMN     "smsOptOutAt" TIMESTAMP(3),
ADD COLUMN     "smsReceipts" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "customerId" TEXT,
    "saleId" TEXT,
    "phone" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "cost" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sms_messages_restaurantId_createdAt_idx" ON "sms_messages"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "sms_messages_customerId_createdAt_idx" ON "sms_messages"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_saleId_kind_key" ON "sms_messages"("saleId", "kind");

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

