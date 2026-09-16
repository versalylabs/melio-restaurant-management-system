import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRaw`
    INSERT INTO _prisma_migrations (id, migration_name, checksum, finished_at, applied_steps_count)
    VALUES ('20260903033000-add-order-management', '20260903033000_add_order_management', 'manual', datetime('now'), 1)
  `;
  console.log('Migration marked as applied');
  await prisma.$disconnect();
}

main();
