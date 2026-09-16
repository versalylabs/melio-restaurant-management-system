CREATE TABLE "shifts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" DATETIME,
  "openingCash" REAL NOT NULL DEFAULT 0,
  "closingCash" REAL,
  "expectedCash" REAL,
  "cashVariance" REAL,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "closedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "shifts_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shifts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shifts_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "shifts_restaurantId_branchId_status_idx" ON "shifts"("restaurantId", "branchId", "status");
CREATE INDEX "shifts_userId_openedAt_idx" ON "shifts"("userId", "openedAt");

CREATE TABLE "expenses" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "shiftId" TEXT,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
  "expenseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vendor" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "expenses_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "expenses_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "expenses_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expenses_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "expenses_restaurantId_branchId_expenseDate_idx" ON "expenses"("restaurantId", "branchId", "expenseDate");
CREATE INDEX "expenses_branchId_status_idx" ON "expenses"("branchId", "status");
CREATE INDEX "expenses_shiftId_idx" ON "expenses"("shiftId");
