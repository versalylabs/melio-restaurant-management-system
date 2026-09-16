CREATE TABLE "notifications" (
  "id" TEXT NOT NULL PRIMARY KEY, "restaurantId" TEXT NOT NULL, "branchId" TEXT, "userId" TEXT, "customerId" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'IN_APP', "type" TEXT NOT NULL, "title" TEXT NOT NULL, "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "referenceType" TEXT, "referenceId" TEXT, "readAt" DATETIME, "sentAt" DATETIME,
  "metadata" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "notifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "notification_preferences" (
  "id" TEXT NOT NULL PRIMARY KEY, "restaurantId" TEXT NOT NULL, "userId" TEXT NOT NULL UNIQUE,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true, "emailEnabled" BOOLEAN NOT NULL DEFAULT true, "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false, "orderUpdates" BOOLEAN NOT NULL DEFAULT true, "lowStock" BOOLEAN NOT NULL DEFAULT true,
  "purchaseUpdates" BOOLEAN NOT NULL DEFAULT true, "loyaltyUpdates" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "notification_preferences_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "notifications_restaurantId_userId_readAt_idx" ON "notifications"("restaurantId", "userId", "readAt");
CREATE INDEX "notifications_restaurantId_createdAt_idx" ON "notifications"("restaurantId", "createdAt");
