const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function ensureUsers() {
  const restaurant = await prisma.restaurant.findFirst();
  if (!restaurant) {
    console.error('No restaurant found!');
    process.exit(1);
  }

  const branch = await prisma.branch.findFirst({ where: { restaurantId: restaurant.id } });
  const hash = await bcrypt.hash('melio@2026', 12);

  // Ensure default roles exist
  const roleNames = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF', 'DELIVERY'];
  const roleMap = {};
  for (const name of roleNames) {
    let r = await prisma.role.findFirst({ where: { name } });
    if (!r) {
      r = await prisma.role.create({
        data: {
          name,
          description: `${name} role`,
          isSystem: true,
          permissions: JSON.stringify(['*']),
        },
      });
    }
    roleMap[name] = r.id;
  }

  const staff = [
    { email: 'owner@example.com', firstName: 'John', lastName: 'Kamau', role: 'OWNER', status: 'ACTIVE' },
    { email: 'manager@example.com', firstName: 'Jane', lastName: 'Wanjiku', role: 'MANAGER', status: 'ACTIVE', branchId: branch?.id },
    { email: 'cashier@example.com', firstName: 'Peter', lastName: 'Mwangi', role: 'CASHIER', status: 'ACTIVE', branchId: branch?.id },
    { email: 'waiter@example.com', firstName: 'Brian', lastName: 'Otieno', role: 'WAITER', status: 'ACTIVE', branchId: branch?.id },
    { email: 'chef@example.com', firstName: 'Mary', lastName: 'Achieng', role: 'CHEF', status: 'ACTIVE', branchId: branch?.id },
    { email: 'delivery@example.com', firstName: 'Delivery', lastName: 'Driver', role: 'DELIVERY', status: 'ACTIVE', branchId: branch?.id, jobTitle: 'Delivery Courier', employeeCode: 'DEL-001' },
  ];

  for (const s of staff) {
    const existing = await prisma.user.findFirst({ where: { email: s.email } });
    const roleId = roleMap[s.role];
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: hash,
          roleId,
          status: 'ACTIVE',
          ...(s.branchId ? { branchId: s.branchId } : {}),
        },
      });
      console.log(`Updated user ${s.email} (${s.role})`);
    } else {
      await prisma.user.create({
        data: {
          restaurantId: restaurant.id,
          email: s.email,
          firstName: s.firstName,
          lastName: s.lastName,
          roleId,
          status: 'ACTIVE',
          passwordHash: hash,
          jobTitle: s.jobTitle,
          employeeCode: s.employeeCode,
          ...(s.branchId ? { branchId: s.branchId } : {}),
        },
      });
      console.log(`Created user ${s.email} (${s.role})`);
    }
  }

  const all = await prisma.user.findMany({ select: { email: true, status: true, role: { select: { name: true } } } });
  console.log('All Users:', all.map(u => ({ email: u.email, role: u.role?.name, status: u.status })));
  process.exit(0);
}

ensureUsers().catch(err => {
  console.error(err);
  process.exit(1);
});
