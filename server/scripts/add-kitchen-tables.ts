import prisma from '../src/config/database';

async function main() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "kitchen_stations" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "restaurantId" TEXT NOT NULL,
        "branchId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "displayOrder" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "kitchen_stations_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "kitchen_stations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "menu_item_stations" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "menuItemId" TEXT NOT NULL,
        "stationId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "menu_item_stations_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "menu_item_stations_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kitchen_stations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "kitchen_tickets" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "restaurantId" TEXT NOT NULL,
        "branchId" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "stationId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'NEW',
        "priority" TEXT NOT NULL DEFAULT 'NORMAL',
        "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "startedAt" DATETIME,
        "readyAt" DATETIME,
        "completedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "kitchen_tickets_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "kitchen_tickets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "kitchen_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "kitchen_tickets_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kitchen_stations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "kitchen_ticket_items" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "ticketId" TEXT NOT NULL,
        "saleItemId" TEXT NOT NULL,
        "menuItemId" TEXT NOT NULL,
        "itemNameSnapshot" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "notes" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "kitchen_ticket_items_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "kitchen_tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "kitchen_ticket_items_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "order_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "kitchen_ticket_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;

  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "kitchen_tickets_orderId_branchId_key" ON "kitchen_tickets"("orderId", "branchId")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "kitchen_tickets_restaurantId_branchId_status_idx" ON "kitchen_tickets"("restaurantId", "branchId", "status")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "kitchen_tickets_branchId_receivedAt_idx" ON "kitchen_tickets"("branchId", "receivedAt")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "kitchen_ticket_items_ticketId_idx" ON "kitchen_ticket_items"("ticketId")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "kitchen_ticket_items_saleItemId_idx" ON "kitchen_ticket_items"("saleItemId")`;
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "menu_item_stations_menuItemId_stationId_key" ON "menu_item_stations"("menuItemId", "stationId")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "kitchen_stations_restaurantId_branchId_idx" ON "kitchen_stations"("restaurantId", "branchId")`;

  console.log('Kitchen tables created successfully');
  await prisma.$disconnect();
}

main();
