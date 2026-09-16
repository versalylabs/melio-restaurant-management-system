import prisma from '../config/database';

async function main() {
  const result = await prisma.$queryRaw<any[]>`
    SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'order%'
  `;
  console.log(result.map(r => r.name));
  await prisma.$disconnect();
}

main();
