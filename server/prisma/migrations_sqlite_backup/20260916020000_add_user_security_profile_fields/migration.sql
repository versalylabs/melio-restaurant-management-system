-- Add user profile/security fields already present in the Prisma schema.
ALTER TABLE "users" ADD COLUMN "employeeCode" TEXT;
ALTER TABLE "users" ADD COLUMN "jobTitle" TEXT;
ALTER TABLE "users" ADD COLUMN "hireDate" DATETIME;
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" DATETIME;
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
