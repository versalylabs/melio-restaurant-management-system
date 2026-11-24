-- CreateTable
CREATE TABLE "licences" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "authority" TEXT,
    "number" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "documentName" TEXT,
    "documentType" TEXT,
    "documentData" BYTEA,
    "reminded30At" TIMESTAMP(3),
    "reminded7At" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "licences_restaurantId_expiresAt_idx" ON "licences"("restaurantId", "expiresAt");

-- AddForeignKey
ALTER TABLE "licences" ADD CONSTRAINT "licences_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

