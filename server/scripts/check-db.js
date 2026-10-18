const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
console.log('Using DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:]+@/, ':****@') : 'UNDEFINED');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rests = await prisma.restaurant.findMany({
    include: { branches: true },
  });
  console.log('Restaurants count:', rests.length);
  for (const r of rests) {
    console.log(`- ${r.id}: ${r.name} (status: ${r.status}, branches: ${r.branches.length})`);
    for (const b of r.branches) {
      console.log(`   branch: ${b.id}: ${b.name} (${b.code}, status: ${b.status})`);
    }
  }

  const categories = await prisma.menuCategory.findMany();
  console.log('Categories count:', categories.length);

  const items = await prisma.menuItem.findMany({
    take: 15,
  });
  console.log('Menu items count:', items.length);
  for (const item of items) {
    console.log(`- Item: "${item.name}", available: ${item.available}, status: ${item.status}, image: "${item.image}"`);
  }

  const gallery = await prisma.websiteGalleryItem.findMany();
  console.log('WebsiteGallery count:', gallery.length);
  for (const g of gallery.slice(0, 5)) {
    console.log(`- Gallery: "${g.title}", image: "${g.image}"`);
  }
}

main()
  .catch((e) => console.error('Error in script:', e))
  .finally(() => prisma.$disconnect());
