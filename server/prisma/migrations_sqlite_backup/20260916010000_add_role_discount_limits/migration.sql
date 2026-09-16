-- Add per-role discount approval limits used by the role and order services.
ALTER TABLE "roles" ADD COLUMN "maxDiscountPercent" REAL NOT NULL DEFAULT 100;
ALTER TABLE "roles" ADD COLUMN "maxDiscountAmount" REAL NOT NULL DEFAULT 1000000;
