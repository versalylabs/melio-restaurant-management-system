-- CreateTable
CREATE TABLE "etims_devices" (
    "branchId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "bhfId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "cmcKey" TEXT NOT NULL,
    "sdcId" TEXT,
    "mrcNo" TEXT,
    "itemClassCode" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "lastInvoiceNo" INTEGER NOT NULL DEFAULT 0,
    "lastItemNo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_devices_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "etims_items" (
    "branchId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etims_items_pkey" PRIMARY KEY ("branchId","itemKey")
);

-- CreateTable
CREATE TABLE "etims_invoices" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "creditNoteId" TEXT,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invoiceNo" INTEGER,
    "environment" TEXT,
    "bhfId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextTryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "curRcptNo" INTEGER,
    "totRcptNo" INTEGER,
    "intrlData" TEXT,
    "rcptSign" TEXT,
    "sdcDateTime" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etims_devices_restaurantId_idx" ON "etims_devices"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "etims_invoices_key_key" ON "etims_invoices"("key");

-- CreateIndex
CREATE INDEX "etims_invoices_restaurantId_status_nextTryAt_idx" ON "etims_invoices"("restaurantId", "status", "nextTryAt");

-- CreateIndex
CREATE INDEX "etims_invoices_saleId_idx" ON "etims_invoices"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "etims_invoices_branchId_environment_bhfId_invoiceNo_key" ON "etims_invoices"("branchId", "environment", "bhfId", "invoiceNo");

-- AddForeignKey
ALTER TABLE "etims_invoices" ADD CONSTRAINT "etims_invoices_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

