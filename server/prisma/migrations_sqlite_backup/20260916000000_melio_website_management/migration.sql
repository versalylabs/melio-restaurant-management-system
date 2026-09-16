ALTER TABLE "branches" ADD COLUMN "callPhone" TEXT;
ALTER TABLE "branches" ADD COLUMN "diningHours" TEXT;

CREATE TABLE "WebsiteSettings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "restaurantId" TEXT NOT NULL UNIQUE,
  "featuredMenuItemId" TEXT,
  "galleryFilters" TEXT NOT NULL DEFAULT '[]',
  "socialLinks" TEXT NOT NULL DEFAULT '{}',
  "updatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WebsiteSettings_featuredMenuItemId_fkey" FOREIGN KEY ("featuredMenuItemId") REFERENCES "menu_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "WebsiteGalleryItem" (
  "id" TEXT NOT NULL PRIMARY KEY, "restaurantId" TEXT NOT NULL, "branchId" TEXT, "title" TEXT NOT NULL, "category" TEXT NOT NULL, "image" TEXT NOT NULL, "description" TEXT, "displayOrder" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "WebsiteGalleryItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WebsiteGalleryItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "WebsiteGalleryItem_restaurantId_status_displayOrder_idx" ON "WebsiteGalleryItem"("restaurantId","status","displayOrder");
CREATE TABLE "WebsiteTestimonial" (
  "id" TEXT NOT NULL PRIMARY KEY, "restaurantId" TEXT NOT NULL, "name" TEXT NOT NULL, "role" TEXT, "rating" INTEGER NOT NULL DEFAULT 5, "text" TEXT NOT NULL, "dateLabel" TEXT, "displayOrder" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "WebsiteTestimonial_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WebsiteTestimonial_restaurantId_status_displayOrder_idx" ON "WebsiteTestimonial"("restaurantId","status","displayOrder");
