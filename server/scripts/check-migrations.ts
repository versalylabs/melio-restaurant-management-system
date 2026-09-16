import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw<any[]>`
    SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at
  `;
  console.log(result);
  await prisma.$disconnect();
}

main();
