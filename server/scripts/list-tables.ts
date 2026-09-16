import prisma from '../src/config/database';

async function main() {
  const result = await prisma.$queryRaw<any[]>`
    SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
  `;
  console.log('Existing tables:', result.map(r => r.name));
  await prisma.$disconnect();
}

main();
