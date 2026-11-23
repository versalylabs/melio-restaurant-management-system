-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "taxCategory" TEXT NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "exemptAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "zeroRatedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "kraPin" TEXT,
ADD COLUMN     "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tourismLevyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "paymentId" TEXT,
    "number" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_counters" (
    "restaurantId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "credit_note_counters_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_paymentId_key" ON "credit_notes"("paymentId");

-- CreateIndex
CREATE INDEX "credit_notes_restaurantId_createdAt_idx" ON "credit_notes"("restaurantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_restaurantId_number_key" ON "credit_notes"("restaurantId", "number");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing bills had VAT added on top of the price (the only mode before this
-- change). Record their standard-rated base so the tax summary covers them.
-- Bills with no VAT are left without a category (reported separately).
UPDATE "orders"
SET "taxableAmount" = GREATEST("subtotal" - "discountAmount", 0)
WHERE "taxAmount" > 0 AND "taxableAmount" = 0;
