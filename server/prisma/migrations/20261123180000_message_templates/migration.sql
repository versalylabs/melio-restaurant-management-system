-- Automated message templates move from the (read-only on serverless) local
-- filesystem into the database. Additive only: safe to apply before deploying.
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channel" TEXT NOT NULL DEFAULT 'BOTH',
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_templates_restaurantId_action_key" ON "message_templates"("restaurantId", "action");

ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
