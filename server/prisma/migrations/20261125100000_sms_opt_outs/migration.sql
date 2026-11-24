-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "smsOptOutSource" TEXT;

-- CreateTable
CREATE TABLE "sms_opt_outs" (
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_opt_outs_pkey" PRIMARY KEY ("phone")
);

