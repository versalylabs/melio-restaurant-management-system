const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const r = await p.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`;
  console.log(JSON.stringify(r));
  await p.$disconnect();
}
main().catch(e => console.error(e));
