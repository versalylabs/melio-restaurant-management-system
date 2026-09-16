import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.restaurant.findFirst();
  if (!existing) {
    console.log('No restaurant found. Running full seed...');
    await fullSeed();
  } else {
    await prisma.restaurant.update({where:{id:existing.id},data:{name:'Melio',legalName:'Melio Restaurant Ltd',email:'info@melio.co.ke'}});
    await prisma.branch.updateMany({where:{restaurantId:existing.id,code:'WL'},data:{name:'Melio - Westlands'}});
    await prisma.branch.updateMany({where:{restaurantId:existing.id,code:'KM'},data:{name:'Melio - Kilimani'}});
    console.log('Restaurant exists. Running Melio seed updates...');
    const users = await prisma.user.findMany({ where: { restaurantId: existing.id } });
    await menuSeed(existing, users);
    const featured = await prisma.menuItem.findFirst({ where: { restaurantId: existing.id, name: 'Grilled Chicken' } });
    await prisma.websiteSettings.upsert({
      where: { restaurantId: existing.id },
      update: { featuredMenuItemId: featured?.id || null, galleryFilters: JSON.stringify([{id:'dishes',label:'Signature Dishes'},{id:'ambience',label:'Interior & Ambience'}]) },
      create: { restaurantId: existing.id, featuredMenuItemId: featured?.id || null, galleryFilters: JSON.stringify([{id:'dishes',label:'Signature Dishes'},{id:'ambience',label:'Interior & Ambience'}]) },
    });
    const galleryBase = (process.env.SUPABASE_URL || 'https://czqznpcgyhcntlpsecla.supabase.co').replace(/\/$/, '');
    const gallery = [['Grilled Chicken','dishes','Grilled Chicken.jpg','Melio signature grilled chicken.'],['Beef Steak','dishes','Beef Steak.jpg','Tender beef steak served with chips and salad.'],['Beef Burger','dishes','Beef Burger.jpg','Melio gourmet beef burger.'],['Chicken Burger','dishes','Chicken Burger.jpg','Grilled chicken burger with house sauce.'],['Chicken Wings','dishes','Chicken Wings.jpg','Spicy grilled chicken wings.'],['Chocolate Cake','dishes','Chocolate Cake.jpg','Rich chocolate layer cake.']];
    if ((await prisma.websiteGalleryItem.count({ where: { restaurantId: existing.id } })) === 0) {
      for (let i=0;i<gallery.length;i++) { const [title,category,filename,description]=gallery[i]; await prisma.websiteGalleryItem.create({data:{restaurantId:existing.id,title,category,image:`${galleryBase}/storage/v1/object/public/menu-images/${encodeURIComponent(filename)}`,description,displayOrder:i}}); }
    }
    const branches = await prisma.branch.findMany({ where: { restaurantId: existing.id } });
    if (branches.length >= 2) { await inventorySeed(existing, branches[0], branches[1]); }
    const moi = await prisma.branch.upsert({ where:{ restaurantId_code:{restaurantId:existing.id,code:'MA'} }, update:{name:'Melio - Moi Avenue',address:'Moi Avenue',city:'Nairobi',phone:'0704611033',callPhone:'0704611033',diningHours:JSON.stringify({mondayThursday:'11:30 AM – 10:30 PM',fridaySaturday:'11:30 AM – 11:30 PM',sunday:'10:00 AM – 09:00 PM'})}, create:{restaurantId:existing.id,name:'Melio - Moi Avenue',code:'MA',address:'Moi Avenue',city:'Nairobi',phone:'0704611033',callPhone:'0704611033',email:'moiavenue@melio.co.ke',diningHours:JSON.stringify({mondayThursday:'11:30 AM – 10:30 PM',fridaySaturday:'11:30 AM – 11:30 PM',sunday:'10:00 AM – 09:00 PM'})} });
    await ensureMoiAvenueOperations(existing, moi);
    const existingMenu = await prisma.menuItem.findMany({where:{restaurantId:existing.id}});
    for (const item of existingMenu) await prisma.menuItemBranch.upsert({where:{menuItemId_branchId:{menuItemId:item.id,branchId:moi.id}},update:{available:true},create:{menuItemId:item.id,branchId:moi.id,available:true}});
    await prisma.user.updateMany({where:{restaurantId:existing.id},data:{passwordHash:await bcrypt.hash('melio@2026',12)}});
  }
}


async function ensureMoiAvenueOperations(restaurant: any, moiAvenue: any) {
  // Moi Avenue must be a fully operational branch, not only a menu-availability entry.
  const sections = [
    { name: 'Main Dining', description: 'Main dining area', displayOrder: 1 },
    { name: 'Terrace', description: 'Outdoor terrace seating', displayOrder: 2 },
    { name: 'VIP Area', description: 'Private dining area', displayOrder: 3 },
  ];

  const createdSections: any[] = [];
  for (const section of sections) {
    const existing = await prisma.section.findFirst({ where: { restaurantId: restaurant.id, branchId: moiAvenue.id, name: section.name } });
    const row = existing
      ? await prisma.section.update({ where: { id: existing.id }, data: { description: section.description, displayOrder: section.displayOrder, status: 'ACTIVE' } })
      : await prisma.section.create({ data: { restaurantId: restaurant.id, branchId: moiAvenue.id, ...section, status: 'ACTIVE' } });
    createdSections.push(row);
  }

  const mainDining = createdSections.find((s) => s.name === 'Main Dining')!;
  const terrace = createdSections.find((s) => s.name === 'Terrace')!;
  const vip = createdSections.find((s) => s.name === 'VIP Area')!;
  const tables = [
    { tableNumber: 'T1', name: 'Table 1', capacity: 2, shape: 'SQUARE', status: 'AVAILABLE', sectionId: mainDining.id, positionX: 50, positionY: 50, width: 70, height: 70 },
    { tableNumber: 'T2', name: 'Table 2', capacity: 4, shape: 'RECTANGLE', status: 'AVAILABLE', sectionId: mainDining.id, positionX: 150, positionY: 50, width: 100, height: 70 },
    { tableNumber: 'T3', name: 'Table 3', capacity: 4, shape: 'SQUARE', status: 'AVAILABLE', sectionId: mainDining.id, positionX: 50, positionY: 150, width: 70, height: 70 },
    { tableNumber: 'T4', name: 'Table 4', capacity: 6, shape: 'CIRCLE', status: 'AVAILABLE', sectionId: terrace.id, positionX: 200, positionY: 150, width: 90, height: 90 },
    { tableNumber: 'T5', name: 'Table 5', capacity: 8, shape: 'RECTANGLE', status: 'AVAILABLE', sectionId: vip.id, positionX: 100, positionY: 280, width: 140, height: 90 },
  ];
  for (const table of tables) {
    await prisma.table.upsert({
      where: { branchId_tableNumber: { branchId: moiAvenue.id, tableNumber: table.tableNumber } },
      update: { ...table, restaurantId: restaurant.id },
      create: { ...table, restaurantId: restaurant.id, branchId: moiAvenue.id, rotation: 0, displayOrder: 0 },
    });
  }

  const stations = [
    { name: 'Main Kitchen', description: 'Main cooking area', displayOrder: 1 },
    { name: 'Grill', description: 'Grill and barbecue', displayOrder: 2 },
    { name: 'Fryer', description: 'Deep frying station', displayOrder: 3 },
    { name: 'Bar', description: 'Beverages and drinks', displayOrder: 4 },
  ];
  const stationMap = new Map<string, any>();
  for (const station of stations) {
    const row = await prisma.kitchenStation.findFirst({ where: { restaurantId: restaurant.id, branchId: moiAvenue.id, name: station.name } });
    const saved = row || await prisma.kitchenStation.create({ data: { restaurantId: restaurant.id, branchId: moiAvenue.id, ...station, status: 'ACTIVE' } });
    stationMap.set(station.name, saved);
  }

  const menuItems = await prisma.menuItem.findMany({ where: { restaurantId: restaurant.id, status: 'ACTIVE' }, select: { id: true, name: true } });
  const stationForItem: Record<string, string> = {
    'Grilled Chicken': 'Grill', 'Beef Steak': 'Grill', 'Chicken Burger': 'Grill', 'Beef Burger': 'Grill',
    'Chicken Wings': 'Fryer', 'Samosa': 'Main Kitchen', 'Chocolate Cake': 'Main Kitchen', 'Coke': 'Bar', 'Fresh Passion Juice': 'Bar',
  };
  for (const item of menuItems) {
    await prisma.menuItemBranch.upsert({
      where: { menuItemId_branchId: { menuItemId: item.id, branchId: moiAvenue.id } },
      update: { available: true },
      create: { menuItemId: item.id, branchId: moiAvenue.id, available: true },
    });
    const station = stationMap.get(stationForItem[item.name] || 'Main Kitchen');
    if (station) {
      await prisma.menuItemStation.upsert({
        where: { menuItemId_stationId: { menuItemId: item.id, stationId: station.id } },
        update: {},
        create: { menuItemId: item.id, stationId: station.id },
      });
    }
  }

  const ingredients = await prisma.ingredient.findMany({ where: { restaurantId: restaurant.id, available: true } });
  for (const ingredient of ingredients) {
    const existingStock = await prisma.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId: moiAvenue.id, ingredientId: ingredient.id } } });
    if (!existingStock) {
      await prisma.inventoryStock.create({
        data: {
          restaurantId: restaurant.id,
          branchId: moiAvenue.id,
          ingredientId: ingredient.id,
          quantity: Math.max(ingredient.reorderLevel + 5, ingredient.minStockLevel + 5),
          unit: ingredient.unit,
          costPerUnit: ingredient.costPerUnit,
          minStockLevel: ingredient.minStockLevel,
          reorderLevel: ingredient.reorderLevel,
        },
      });
    }
  }

  console.log('Moi Avenue operational data verified: sections, tables, kitchen stations, menu routing and inventory stock.');
}

async function fullSeed() {
  const roles = await Promise.all([
    prisma.role.upsert({
      where: { name: 'OWNER' },
      update: {},
      create: { name: 'OWNER', description: 'Full system access', permissions: JSON.stringify(['*']), isSystem: true },
    }),
    prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { name: 'ADMIN', description: 'Administrative access', permissions: JSON.stringify(['read', 'write', 'manage']), isSystem: true },
    }),
    prisma.role.upsert({
      where: { name: 'MANAGER' },
      update: {},
      create: { name: 'MANAGER', description: 'Management access', permissions: JSON.stringify(['read', 'write']), isSystem: true },
    }),
    prisma.role.upsert({
      where: { name: 'CASHIER' },
      update: {},
      create: { name: 'CASHIER', description: 'Cashier access', permissions: JSON.stringify(['read', 'write:orders', 'write:payments']), isSystem: true },
    }),
    prisma.role.upsert({
      where: { name: 'WAITER' },
      update: {},
      create: { name: 'WAITER', description: 'Waiter access', permissions: JSON.stringify(['read', 'write:orders']), isSystem: true },
    }),
    prisma.role.upsert({
      where: { name: 'CHEF' },
      update: {},
      create: { name: 'CHEF', description: 'Kitchen access', permissions: JSON.stringify(['read:orders', 'write:orders']), isSystem: true },
    }),
    prisma.role.upsert({
      where: { name: 'INVENTORY_MANAGER' },
      update: {},
      create: { name: 'INVENTORY_MANAGER', description: 'Inventory management access', permissions: JSON.stringify(['read', 'write:inventory']), isSystem: true },
    }),
  ]);

  console.log('Roles seeded:', roles.map((r) => r.name).join(', '));

  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'Melio',
      legalName: 'Melio Restaurant Ltd',
      description: 'A modern dining experience in the heart of Nairobi',
      phone: '+254 20 123 4567',
      email: 'info@melio.co.ke',
      address: '123 Kenyatta Avenue',
      city: 'Nairobi',
      country: 'Kenya',
      currency: 'KES',
      timezone: 'Africa/Nairobi',
      status: 'ACTIVE',
    },
  });

  console.log('Restaurant created:', restaurant.name);

  const westlandsBranch = await prisma.branch.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Melio - Westlands',
      code: 'WL',
      phone: '+254 20 123 4567',
      email: 'westlands@melio.co.ke',
      address: '123 Westlands Road',
      city: 'Nairobi',
      status: 'ACTIVE',
    },
  });

  const kilimaniBranch = await prisma.branch.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Melio - Kilimani',
      code: 'KM',
      phone: '+254 20 123 4568',
      email: 'kilimani@melio.co.ke',
      address: '45 Kilimani Road',
      city: 'Nairobi',
      status: 'ACTIVE',
    },
  });

  const moiAvenueBranch = await prisma.branch.create({ data: { restaurantId: restaurant.id, name: 'Melio - Moi Avenue', code: 'MA', phone: '0704611033', callPhone: '0704611033', email: 'moiavenue@melio.co.ke', address: 'Moi Avenue', city: 'Nairobi', diningHours: JSON.stringify({mondayThursday:'11:30 AM – 10:30 PM',fridaySaturday:'11:30 AM – 11:30 PM',sunday:'10:00 AM – 09:00 PM'}), status:'ACTIVE' } });
  console.log('Branches created:', westlandsBranch.name, ',', kilimaniBranch.name, ',', moiAvenueBranch.name);

  const ownerRole = roles.find((r) => r.name === 'OWNER')!;
  const managerRole = roles.find((r) => r.name === 'MANAGER')!;
  const cashierRole = roles.find((r) => r.name === 'CASHIER')!;
  const waiterRole = roles.find((r) => r.name === 'WAITER')!;
  const chefRole = roles.find((r) => r.name === 'CHEF')!;

  const passwordHash = await bcrypt.hash('melio@2026', 12);

  const users = await Promise.all([
    prisma.user.create({
      data: { restaurantId: restaurant.id, firstName: 'John', lastName: 'Kamau', email: 'owner@example.com', phone: '+254 700 000 001', passwordHash, roleId: ownerRole.id, status: 'ACTIVE' },
    }),
    prisma.user.create({
      data: { restaurantId: restaurant.id, branchId: westlandsBranch.id, firstName: 'Jane', lastName: 'Wanjiku', email: 'manager@example.com', phone: '+254 700 000 002', passwordHash, roleId: managerRole.id, status: 'ACTIVE' },
    }),
    prisma.user.create({
        data: { restaurantId: restaurant.id, branchId: westlandsBranch.id, firstName: 'Peter', lastName: 'Mwangi', email: 'cashier@example.com', phone: '+254 700 000 003', passwordHash, roleId: cashierRole.id, status: 'ACTIVE' },
    }),
    prisma.user.create({
      data: { restaurantId: restaurant.id, branchId: westlandsBranch.id, firstName: 'Brian', lastName: 'Otieno', email: 'waiter@example.com', phone: '+254 700 000 004', passwordHash, roleId: waiterRole.id, status: 'ACTIVE' },
    }),
    prisma.user.create({
      data: { restaurantId: restaurant.id, branchId: westlandsBranch.id, firstName: 'Mary', lastName: 'Achieng', email: 'chef@example.com', phone: '+254 700 000 005', passwordHash, roleId: chefRole.id, status: 'ACTIVE' },
    }),
  ]);

  console.log('Users created:', users.map((u) => u.email).join(', '));

  await menuSeed(restaurant, users);
  await ensureMoiAvenueOperations(restaurant, moiAvenueBranch);
  const featured = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Grilled Chicken' } });
  await prisma.websiteSettings.upsert({
    where: { restaurantId: restaurant.id },
    update: { featuredMenuItemId: featured?.id || null, galleryFilters: JSON.stringify([{id:'dishes',label:'Signature Dishes'},{id:'ambience',label:'Interior & Ambience'}]) },
    create: { restaurantId: restaurant.id, featuredMenuItemId: featured?.id || null, galleryFilters: JSON.stringify([{id:'dishes',label:'Signature Dishes'},{id:'ambience',label:'Interior & Ambience'}]) },
  });
  const galleryBase = (process.env.SUPABASE_URL || 'https://czqznpcgyhcntlpsecla.supabase.co').replace(/\/$/, '');
  const gallery = [
    ['Grilled Chicken', 'dishes', 'Grilled Chicken.jpg', 'Melio signature grilled chicken.'],
    ['Beef Steak', 'dishes', 'Beef Steak.jpg', 'Tender beef steak served with chips and salad.'],
    ['Beef Burger', 'dishes', 'Beef Burger.jpg', 'Melio gourmet beef burger.'],
    ['Chicken Burger', 'dishes', 'Chicken Burger.jpg', 'Grilled chicken burger with house sauce.'],
    ['Chicken Wings', 'dishes', 'Chicken Wings.jpg', 'Spicy grilled chicken wings.'],
    ['Chocolate Cake', 'dishes', 'Chocolate Cake.jpg', 'Rich chocolate layer cake.'],
  ];
  if ((await prisma.websiteGalleryItem.count({ where: { restaurantId: restaurant.id } })) === 0) {
    for (let i = 0; i < gallery.length; i++) {
      const [title, category, filename, description] = gallery[i];
      await prisma.websiteGalleryItem.create({ data: { restaurantId: restaurant.id, title, category, image: `${galleryBase}/storage/v1/object/public/menu-images/${encodeURIComponent(filename)}`, description, displayOrder: i } });
    }
  }
}

async function menuSeed(restaurant: any, users: any) {
  const categories = [
    { name: 'Starters', description: 'Light bites and appetizers', displayOrder: 1 },
    { name: 'Main Course', description: 'Our signature main dishes', displayOrder: 2 },
    { name: 'Burgers', description: 'Juicy gourmet burgers', displayOrder: 3 },
    { name: 'Drinks', description: 'Refreshing beverages', displayOrder: 4 },
    { name: 'Desserts', description: 'Sweet treats', displayOrder: 5 },
  ];

  const createdCategories: any = [];
  for (const cat of categories) {
    const existing = await prisma.menuCategory.findFirst({ where: { restaurantId: restaurant.id, name: cat.name } });
    if (!existing) {
      const created = await prisma.menuCategory.create({ data: { ...cat, restaurantId: restaurant.id } });
      createdCategories.push(created);
    } else {
      createdCategories.push(existing);
    }
  }

  console.log('Categories seeded:', createdCategories.map((c: any) => c.name).join(', '));

  const modifiers = [
    { name: 'Burger Size', description: 'Choose your size', selectionType: 'SINGLE', isRequired: true, options: [{ name: 'Regular', priceAdjustment: 0 }, { name: 'Large', priceAdjustment: 200 }] },
    { name: 'Burger Extras', description: 'Add extra toppings', selectionType: 'MULTIPLE', isRequired: false, options: [{ name: 'Extra Cheese', priceAdjustment: 100 }, { name: 'Extra Bacon', priceAdjustment: 150 }, { name: 'Extra Sauce', priceAdjustment: 50 }] },
    { name: 'Pizza Size', description: 'Choose pizza size', selectionType: 'SINGLE', isRequired: true, options: [{ name: 'Small', priceAdjustment: 0 }, { name: 'Medium', priceAdjustment: 300 }, { name: 'Large', priceAdjustment: 600 }] },
  ];

  const createdModifierGroups: any = [];
  for (const mod of modifiers) {
    const existing = await prisma.modifierGroup.findFirst({ where: { restaurantId: restaurant.id, name: mod.name } });
    let group: any;
    if (!existing) {
      group = await prisma.modifierGroup.create({ data: { name: mod.name, description: mod.description, selectionType: mod.selectionType, isRequired: mod.isRequired, displayOrder: mod.displayOrder, restaurantId: restaurant.id } });
      for (const opt of mod.options) {
        await prisma.modifierOption.create({ data: { name: opt.name, priceAdjustment: opt.priceAdjustment, modifierGroupId: group.id } });
      }
    } else {
      group = existing;
      for (const opt of mod.options) {
        const existingOpt = await prisma.modifierOption.findFirst({ where: { modifierGroupId: group.id, name: opt.name } });
        if (!existingOpt) {
          await prisma.modifierOption.create({ data: { name: opt.name, priceAdjustment: opt.priceAdjustment, modifierGroupId: group.id } });
        }
      }
    }
    createdModifierGroups.push(group);
  }

  console.log('Modifier groups seeded:', createdModifierGroups.map((g: any) => g.name).join(', '));

  const branches = await prisma.branch.findMany({ where: { restaurantId: restaurant.id } });
  const westlands = branches.find((b: any) => b.code === 'WL')!;
  const kilimani = branches.find((b: any) => b.code === 'KM')!;
  const moiAvenue = branches.find((b: any) => b.code === 'MA');

  const supabaseBase = (process.env.SUPABASE_URL || 'https://czqznpcgyhcntlpsecla.supabase.co').replace(/\/$/, '');
  const imageUrl = (filename: string) => `${supabaseBase}/storage/v1/object/public/menu-images/${encodeURIComponent(filename)}`;

  const menuItems = [
    { categoryName: 'Starters', name: 'Samosa', image: imageUrl('Samosa.jpg'), description: 'Crispy triangular pastries with spiced meat filling', sellingPrice: 300, costPrice: 120, taxRate: 0, preparationTime: 10, available: true },
    { categoryName: 'Starters', name: 'Chicken Wings', image: imageUrl('Chicken Wings.jpg'), description: 'Spicy grilled chicken wings', sellingPrice: 650, costPrice: 280, taxRate: 0, preparationTime: 20, available: true },
    { categoryName: 'Main Course', name: 'Grilled Chicken', image: imageUrl('Grilled Chicken.jpg'), description: 'Half chicken grilled with vegetables and ugali', sellingPrice: 1200, costPrice: 500, taxRate: 0, preparationTime: 30, available: true },
    { categoryName: 'Main Course', name: 'Beef Steak', image: imageUrl('Beef Steak.jpg'), description: 'Tender beef steak with chips and salad', sellingPrice: 1800, costPrice: 750, taxRate: 0, preparationTime: 25, available: true },
    { categoryName: 'Burgers', name: 'Chicken Burger', image: imageUrl('Chicken Burger.jpg'), description: 'Grilled chicken breast with lettuce, tomato and house sauce', sellingPrice: 850, costPrice: 300, taxRate: 0, preparationTime: 15, available: true, modifierGroupNames: ['Burger Size', 'Burger Extras'] },
    { categoryName: 'Burgers', name: 'Beef Burger', image: imageUrl('Beef Burger.jpg'), description: 'Quarter pound beef patty with cheese and pickles', sellingPrice: 950, costPrice: 350, taxRate: 0, preparationTime: 15, available: true, modifierGroupNames: ['Burger Size', 'Burger Extras'] },
    { categoryName: 'Drinks', name: 'Coke', image: imageUrl('Coke.jpg'), description: 'Ice cold Coca-Cola 500ml', sellingPrice: 150, costPrice: 60, taxRate: 0, preparationTime: 2, available: true },
    { categoryName: 'Drinks', name: 'Fresh Passion Juice', image: imageUrl('Passion Juice.jpg'), description: 'Freshly squeezed passion fruit juice', sellingPrice: 300, costPrice: 100, taxRate: 0, preparationTime: 5, available: true },
    { categoryName: 'Desserts', name: 'Chocolate Cake', image: imageUrl('Chocolate Cake.jpg'), description: 'Rich chocolate layer cake', sellingPrice: 450, costPrice: 180, taxRate: 0, preparationTime: 5, available: true },
  ];

  for (const item of menuItems) {
    const category = createdCategories.find((c: any) => c.name === item.categoryName);
    if (!category) continue;

    const existing = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: item.name } });
    let menuItem: any;
    if (!existing) {
      menuItem = await prisma.menuItem.create({
        data: {
          restaurantId: restaurant.id,
          categoryId: category.id,
          name: item.name,
          description: item.description,
          image: item.image,
          sellingPrice: item.sellingPrice,
          costPrice: item.costPrice,
          taxRate: item.taxRate,
          preparationTime: item.preparationTime,
          available: item.available,
          status: 'ACTIVE',
        },
      });

      await prisma.menuItemBranch.create({ data: { menuItemId: menuItem.id, branchId: westlands.id, available: true } });
      await prisma.menuItemBranch.create({ data: { menuItemId: menuItem.id, branchId: kilimani.id, available: true } });
      if (moiAvenue) await prisma.menuItemBranch.create({ data: { menuItemId: menuItem.id, branchId: moiAvenue.id, available: true } });

      if (item.modifierGroupNames) {
        for (const modName of item.modifierGroupNames) {
          const modGroup = createdModifierGroups.find((g: any) => g.name === modName);
          if (modGroup) {
            await prisma.menuItemModifierGroup.create({
              data: { menuItemId: menuItem.id, modifierGroupId: modGroup.id },
            });
          }
        }
      }
    } else {
      menuItem = existing;
      if (item.image && menuItem.image !== item.image) {
        menuItem = await prisma.menuItem.update({ where: { id: menuItem.id }, data: { image: item.image } });
      }
      const existingBranches = await prisma.menuItemBranch.findMany({ where: { menuItemId: menuItem.id } });
      const existingBranchIds = existingBranches.map((b: any) => b.branchId);
      if (!existingBranchIds.includes(westlands.id)) {
        await prisma.menuItemBranch.create({ data: { menuItemId: menuItem.id, branchId: westlands.id, available: true } });
      }
      if (!existingBranchIds.includes(kilimani.id)) {
        await prisma.menuItemBranch.create({ data: { menuItemId: menuItem.id, branchId: kilimani.id, available: true } });
      }
      if (moiAvenue && !existingBranchIds.includes(moiAvenue.id)) {
        await prisma.menuItemBranch.create({ data: { menuItemId: menuItem.id, branchId: moiAvenue.id, available: true } });
      }
    }
  }

  console.log('Menu items seeded');

  await tableSeed(restaurant, westlands, kilimani, users);
  await kitchenSeed(restaurant, westlands, kilimani);
  await inventorySeed(restaurant, westlands, kilimani);

  console.log('\nPhase 2, Phase 3, Phase 4 and Phase 5 seed completed successfully!');
}

async function tableSeed(restaurant: any, westlands: any, kilimani: any, users: any) {
  const westlandsSections = [
    { name: 'Main Dining', description: 'Main dining area', displayOrder: 1 },
    { name: 'Terrace', description: 'Outdoor terrace seating', displayOrder: 2 },
    { name: 'VIP Area', description: 'Private VIP section', displayOrder: 3 },
  ];

  const kilimaniSections = [
    { name: 'Main Dining', description: 'Main dining area', displayOrder: 1 },
    { name: 'Outdoor', description: 'Outdoor seating', displayOrder: 2 },
  ];

  const createdWestlandsSections: any = [];
  for (const section of westlandsSections) {
    const existing = await prisma.section.findFirst({ where: { restaurantId: restaurant.id, branchId: westlands.id, name: section.name } });
    if (!existing) {
      const created = await prisma.section.create({ data: { ...section, restaurantId: restaurant.id, branchId: westlands.id } });
      createdWestlandsSections.push(created);
    } else {
      createdWestlandsSections.push(existing);
    }
  }

  const createdKilimaniSections: any = [];
  for (const section of kilimaniSections) {
    const existing = await prisma.section.findFirst({ where: { restaurantId: restaurant.id, branchId: kilimani.id, name: section.name } });
    if (!existing) {
      const created = await prisma.section.create({ data: { ...section, restaurantId: restaurant.id, branchId: kilimani.id } });
      createdKilimaniSections.push(created);
    } else {
      createdKilimaniSections.push(existing);
    }
  }

  console.log('Sections seeded:', [...createdWestlandsSections, ...createdKilimaniSections].map((s: any) => s.name).join(', '));

  const westlandsMainDining = createdWestlandsSections.find((s: any) => s.name === 'Main Dining')!;
  const westlandsTerrace = createdWestlandsSections.find((s: any) => s.name === 'Terrace')!;
  const westlandsVip = createdWestlandsSections.find((s: any) => s.name === 'VIP Area')!;
  const kilimaniMainDining = createdKilimaniSections.find((s: any) => s.name === 'Main Dining')!;
  const kilimaniOutdoor = createdKilimaniSections.find((s: any) => s.name === 'Outdoor')!;

  const westlandsTables = [
    { tableNumber: 'T1', name: 'Table 1', capacity: 2, shape: 'SQUARE', status: 'AVAILABLE', sectionId: westlandsMainDining.id, positionX: 50, positionY: 50, width: 70, height: 70 },
    { tableNumber: 'T2', name: 'Table 2', capacity: 2, shape: 'SQUARE', status: 'OCCUPIED', sectionId: westlandsMainDining.id, positionX: 150, positionY: 50, width: 70, height: 70 },
    { tableNumber: 'T3', name: 'Table 3', capacity: 4, shape: 'RECTANGLE', status: 'AVAILABLE', sectionId: westlandsMainDining.id, positionX: 250, positionY: 50, width: 100, height: 70 },
    { tableNumber: 'T4', name: 'Table 4', capacity: 4, shape: 'RECTANGLE', status: 'RESERVED', sectionId: westlandsMainDining.id, positionX: 50, positionY: 150, width: 100, height: 70 },
    { tableNumber: 'T5', name: 'Table 5', capacity: 6, shape: 'RECTANGLE', status: 'CLEANING', sectionId: westlandsTerrace.id, positionX: 200, positionY: 150, width: 120, height: 80 },
    { tableNumber: 'T6', name: 'Table 6', capacity: 6, shape: 'CIRCLE', status: 'AVAILABLE', sectionId: westlandsTerrace.id, positionX: 350, positionY: 150, width: 90, height: 90 },
    { tableNumber: 'T7', name: 'Table 7', capacity: 8, shape: 'RECTANGLE', status: 'OUT_OF_SERVICE', sectionId: westlandsVip.id, positionX: 100, positionY: 250, width: 140, height: 90 },
  ];

  const kilimaniTables = [
    { tableNumber: 'T1', name: 'Table 1', capacity: 2, shape: 'SQUARE', status: 'AVAILABLE', sectionId: kilimaniMainDining.id, positionX: 50, positionY: 50, width: 70, height: 70 },
    { tableNumber: 'T2', name: 'Table 2', capacity: 4, shape: 'RECTANGLE', status: 'AVAILABLE', sectionId: kilimaniMainDining.id, positionX: 150, positionY: 50, width: 100, height: 70 },
    { tableNumber: 'T3', name: 'Table 3', capacity: 4, shape: 'SQUARE', status: 'OCCUPIED', sectionId: kilimaniMainDining.id, positionX: 50, positionY: 150, width: 70, height: 70 },
    { tableNumber: 'T4', name: 'Table 4', capacity: 6, shape: 'CIRCLE', status: 'AVAILABLE', sectionId: kilimaniOutdoor.id, positionX: 200, positionY: 150, width: 90, height: 90 },
  ];

  for (const table of [...westlandsTables, ...kilimaniTables]) {
    const branchId = [westlandsMainDining.id, westlandsTerrace.id, westlandsVip.id].includes(table.sectionId) ? westlands.id : kilimani.id;
    const existing = await prisma.table.findFirst({ where: { branchId, tableNumber: table.tableNumber } });
    if (!existing) {
      await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          branchId,
          sectionId: table.sectionId,
          tableNumber: table.tableNumber,
          name: table.name,
          capacity: table.capacity,
          shape: table.shape,
          status: table.status,
          positionX: table.positionX,
          positionY: table.positionY,
          width: table.width,
          height: table.height,
          rotation: 0,
          displayOrder: 0,
        },
      });
    }
  }

  console.log('Tables seeded');

  await orderSeed(restaurant, westlands, kilimani, users);

  console.log('\nPhase 2, Phase 3 and Phase 4 seed completed successfully!');
}

async function orderSeed(restaurant: any, westlands: any, kilimani: any, users: any) {
  const owner = users.find((u: any) => u.email === 'owner@example.com');
  const manager = users.find((u: any) => u.email === 'manager@example.com');
  const cashier = users.find((u: any) => u.email === 'cashier@example.com');
  const waiter = users.find((u: any) => u.email === 'waiter@example.com');

  const chickenBurger = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Chicken Burger' } });
  const beefBurger = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Beef Burger' } });
  const coke = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Coke' } });
  const passionJuice = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Fresh Passion Juice' } });
  const chocolateCake = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Chocolate Cake' } });
  const grilledChicken = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Grilled Chicken' } });
  const beefSteak = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Beef Steak' } });
  const samosa = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Samosa' } });
  const chickenWings = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Chicken Wings' } });

  const burgerSize = await prisma.modifierGroup.findFirst({ where: { restaurantId: restaurant.id, name: 'Burger Size' } });
  const burgerExtras = await prisma.modifierGroup.findFirst({ where: { restaurantId: restaurant.id, name: 'Burger Extras' } });

  const regularSize = burgerSize ? await prisma.modifierOption.findFirst({ where: { modifierGroupId: burgerSize.id, name: 'Regular' } }) : null;
  const largeSize = burgerSize ? await prisma.modifierOption.findFirst({ where: { modifierGroupId: burgerSize.id, name: 'Large' } }) : null;
  const extraCheese = burgerExtras ? await prisma.modifierOption.findFirst({ where: { modifierGroupId: burgerExtras.id, name: 'Extra Cheese' } }) : null;
  const extraBacon = burgerExtras ? await prisma.modifierOption.findFirst({ where: { modifierGroupId: burgerExtras.id, name: 'Extra Bacon' } }) : null;

  const westlandsT1 = await prisma.table.findFirst({ where: { branchId: westlands.id, tableNumber: 'T1' } });
  const westlandsT2 = await prisma.table.findFirst({ where: { branchId: westlands.id, tableNumber: 'T2' } });
  const westlandsT3 = await prisma.table.findFirst({ where: { branchId: westlands.id, tableNumber: 'T3' } });
  const westlandsT5 = await prisma.table.findFirst({ where: { branchId: westlands.id, tableNumber: 'T5' } });
  const kilimaniT1 = await prisma.table.findFirst({ where: { branchId: kilimani.id, tableNumber: 'T1' } });
  const kilimaniT2 = await prisma.table.findFirst({ where: { branchId: kilimani.id, tableNumber: 'T2' } });

  const existingOrderCount = await prisma.sale.count({ where: { restaurantId: restaurant.id } });
  if (existingOrderCount > 0) {
    console.log('Orders already seeded');
    return;
  }

  const orders = [
    {
      orderNumber: '#1001',
      branchId: westlands.id,
      orderType: 'DINE_IN',
      tableId: westlandsT1.id,
      customerName: 'Alice Mwangi',
      status: 'COMPLETED',
      subtotal: 2050,
      discountAmount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      totalAmount: 2050,
      notes: 'Birthday celebration',
      createdBy: waiter.id,
      completedAt: new Date(Date.now() - 86400000 * 2),
      items: [
        { menuItemId: chickenBurger.id, itemNameSnapshot: 'Chicken Burger', unitPrice: 850, quantity: 2, modifiers: [{ modifierOptionId: regularSize.id, optionNameSnapshot: 'Regular', priceAdjustment: 0 }, { modifierOptionId: extraCheese.id, optionNameSnapshot: 'Extra Cheese', priceAdjustment: 100 }], notes: '' },
        { menuItemId: coke.id, itemNameSnapshot: 'Coke', unitPrice: 150, quantity: 2, modifiers: [], notes: '' },
      ],
    },
    {
      orderNumber: '#1002',
      branchId: westlands.id,
      orderType: 'DINE_IN',
      tableId: westlandsT3.id,
      customerName: 'Bob Kamau',
      status: 'COMPLETED',
      subtotal: 2100,
      discountAmount: 200,
      taxAmount: 0,
      serviceChargeAmount: 0,
      totalAmount: 1900,
      discountReason: 'Loyalty discount',
      discountAppliedBy: manager.id,
      createdBy: waiter.id,
      completedAt: new Date(Date.now() - 86400000),
      items: [
        { menuItemId: beefSteak.id, itemNameSnapshot: 'Beef Steak', unitPrice: 1800, quantity: 1, modifiers: [], notes: 'Medium rare' },
        { menuItemId: passionJuice.id, itemNameSnapshot: 'Fresh Passion Juice', unitPrice: 300, quantity: 1, modifiers: [], notes: '' },
      ],
    },
    {
      orderNumber: '#1003',
      branchId: westlands.id,
      orderType: 'TAKEAWAY',
      tableId: null,
      customerName: null,
      status: 'SUBMITTED',
      subtotal: 2550,
      discountAmount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      totalAmount: 2550,
      notes: 'Pickup in 15 mins',
      createdBy: cashier.id,
      items: [
        { menuItemId: chickenBurger.id, itemNameSnapshot: 'Chicken Burger', unitPrice: 850, quantity: 2, modifiers: [{ modifierOptionId: largeSize.id, optionNameSnapshot: 'Large', priceAdjustment: 200 }], notes: '' },
        { menuItemId: chickenWings.id, itemNameSnapshot: 'Chicken Wings', unitPrice: 650, quantity: 1, modifiers: [], notes: 'Extra spicy' },
      ],
    },
    {
      orderNumber: '#1004',
      branchId: westlands.id,
      orderType: 'DINE_IN',
      tableId: westlandsT5.id,
      customerName: 'Carol Njeri',
      status: 'HELD',
      subtotal: 3600,
      discountAmount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      totalAmount: 3600,
      notes: 'Customer still deciding',
      createdBy: waiter.id,
      items: [
        { menuItemId: grilledChicken.id, itemNameSnapshot: 'Grilled Chicken', unitPrice: 1200, quantity: 3, modifiers: [], notes: '' },
        { menuItemId: coke.id, itemNameSnapshot: 'Coke', unitPrice: 150, quantity: 3, modifiers: [], notes: '' },
      ],
    },
    {
      orderNumber: '#1005',
      branchId: kilimani.id,
      orderType: 'DINE_IN',
      tableId: kilimaniT1.id,
      customerName: 'David Otieno',
      status: 'COMPLETED',
      subtotal: 950,
      discountAmount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      totalAmount: 950,
      createdBy: waiter.id,
      completedAt: new Date(Date.now() - 86400000 * 3),
      items: [
        { menuItemId: beefBurger.id, itemNameSnapshot: 'Beef Burger', unitPrice: 950, quantity: 1, modifiers: [{ modifierOptionId: extraBacon.id, optionNameSnapshot: 'Extra Bacon', priceAdjustment: 150 }], notes: '' },
      ],
    },
    {
      orderNumber: '#1006',
      branchId: kilimani.id,
      orderType: 'TAKEAWAY',
      tableId: null,
      customerName: null,
      status: 'CANCELLED',
      subtotal: 1700,
      discountAmount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      totalAmount: 1700,
      cancelReason: 'Customer changed mind',
      cancelledBy: cashier.id,
      createdBy: cashier.id,
      items: [
        { menuItemId: chickenBurger.id, itemNameSnapshot: 'Chicken Burger', unitPrice: 850, quantity: 2, modifiers: [], notes: '' },
      ],
    },
  ];

  for (const orderData of orders) {
    const { items, ...orderInfo } = orderData;
    const order = await prisma.sale.create({
      data: {
        ...orderInfo,
        restaurantId: restaurant.id,
        items: {
          create: items.map((item: any) => ({
            menuItemId: item.menuItemId,
            itemNameSnapshot: item.itemNameSnapshot,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            subtotal: item.unitPrice * item.quantity + item.modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment * item.quantity, 0),
            notes: item.notes || null,
            modifiers: {
              create: item.modifiers.map((mod: any) => ({
                modifierOptionId: mod.modifierOptionId,
                optionNameSnapshot: mod.optionNameSnapshot,
                priceAdjustment: mod.priceAdjustment,
              })),
            },
          })),
        },
      },
    });

    if (order.status !== 'DRAFT') {
      await prisma.saleStatusHistory.create({
        data: {
          saleId: order.id,
          status: order.status,
          changedBy: order.createdBy,
          notes: `Seeded with status ${order.status}`,
        },
      });
    }
  }

  console.log('Orders seeded:', orders.length);

  await kitchenSeed(restaurant, westlands, kilimani);

  console.log('\nPhase 5 kitchen seed completed successfully!');
}

async function kitchenSeed(restaurant: any, westlands: any, kilimani: any) {
  const existingStationCount = await prisma.kitchenStation.count({ where: { restaurantId: restaurant.id } });
  if (existingStationCount > 0) {
    console.log('Kitchen stations already seeded');
    return;
  }

  const westlandsStations = [
    { name: 'Main Kitchen', description: 'Main cooking area', displayOrder: 1 },
    { name: 'Grill', description: 'Grill and barbecue', displayOrder: 2 },
    { name: 'Fryer', description: 'Deep frying station', displayOrder: 3 },
    { name: 'Bar', description: 'Beverages and drinks', displayOrder: 4 },
  ];

  const kilimaniStations = [
    { name: 'Main Kitchen', description: 'Main cooking area', displayOrder: 1 },
    { name: 'Grill', description: 'Grill and barbecue', displayOrder: 2 },
    { name: 'Bar', description: 'Beverages and drinks', displayOrder: 3 },
  ];

  const createdWestlandsStations: any = [];
  for (const station of westlandsStations) {
    const created = await prisma.kitchenStation.create({
      data: { ...station, restaurantId: restaurant.id, branchId: westlands.id },
    });
    createdWestlandsStations.push(created);
  }

  const createdKilimaniStations: any = [];
  for (const station of kilimaniStations) {
    const created = await prisma.kitchenStation.create({
      data: { ...station, restaurantId: restaurant.id, branchId: kilimani.id },
    });
    createdKilimaniStations.push(created);
  }

  console.log('Kitchen stations seeded:', [...createdWestlandsStations, ...createdKilimaniStations].map((s: any) => s.name).join(', '));

  const westlandsMainKitchen = createdWestlandsStations.find((s: any) => s.name === 'Main Kitchen')!;
  const westlandsGrill = createdWestlandsStations.find((s: any) => s.name === 'Grill')!;
  const westlandsFryer = createdWestlandsStations.find((s: any) => s.name === 'Fryer')!;
  const westlandsBar = createdWestlandsStations.find((s: any) => s.name === 'Bar')!;
  const kilimaniMainKitchen = createdKilimaniStations.find((s: any) => s.name === 'Main Kitchen')!;
  const kilimaniGrill = createdKilimaniStations.find((s: any) => s.name === 'Grill')!;
  const kilimaniBar = createdKilimaniStations.find((s: any) => s.name === 'Bar')!;

  const chickenBurger = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Chicken Burger' } });
  const beefBurger = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Beef Burger' } });
  const coke = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Coke' } });
  const passionJuice = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Fresh Passion Juice' } });
  const chocolateCake = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Chocolate Cake' } });
  const grilledChicken = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Grilled Chicken' } });
  const beefSteak = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Beef Steak' } });
  const samosa = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Samosa' } });
  const chickenWings = await prisma.menuItem.findFirst({ where: { restaurantId: restaurant.id, name: 'Chicken Wings' } });

  const menuItemStationAssignments = [
    { menuItemId: chickenBurger.id, stationId: westlandsGrill.id },
    { menuItemId: beefBurger.id, stationId: westlandsGrill.id },
    { menuItemId: grilledChicken.id, stationId: westlandsGrill.id },
    { menuItemId: beefSteak.id, stationId: westlandsGrill.id },
    { menuItemId: chickenWings.id, stationId: westlandsFryer.id },
    { menuItemId: samosa.id, stationId: westlandsMainKitchen.id },
    { menuItemId: coke.id, stationId: westlandsBar.id },
    { menuItemId: passionJuice.id, stationId: westlandsBar.id },
    { menuItemId: chocolateCake.id, stationId: westlandsMainKitchen.id },
    { menuItemId: chickenBurger.id, stationId: kilimaniGrill.id },
    { menuItemId: beefBurger.id, stationId: kilimaniGrill.id },
    { menuItemId: coke.id, stationId: kilimaniBar.id },
    { menuItemId: passionJuice.id, stationId: kilimaniBar.id },
  ];

  for (const assignment of menuItemStationAssignments) {
    const existing = await prisma.menuItemStation.findFirst({ where: { menuItemId: assignment.menuItemId, stationId: assignment.stationId } });
    if (!existing) {
      await prisma.menuItemStation.create({ data: assignment });
    }
  }

  console.log('Menu item station assignments seeded');

  const westlandsOrders = await prisma.sale.findMany({ where: { branchId: westlands.id, status: { not: 'DRAFT' } } });
  const kilimaniOrders = await prisma.sale.findMany({ where: { branchId: kilimani.id, status: { not: 'DRAFT' } } });

  for (const order of [...westlandsOrders, ...kilimaniOrders]) {
    const existing = await prisma.kitchenTicket.findFirst({ where: { orderId: order.id, branchId: order.branchId } });
    if (existing) continue;

    const items = await prisma.saleItem.findMany({
      where: { saleId: order.id },
      include: { modifiers: true },
    });

    const ticket = await prisma.kitchenTicket.create({
      data: {
        restaurantId: restaurant.id,
        branchId: order.branchId,
        orderId: order.id,
        stationId: null,
        status: order.status === 'SUBMITTED' ? 'NEW' : order.status === 'PREPARING' ? 'PREPARING' : order.status === 'READY' ? 'READY' : order.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
        priority: 'NORMAL',
        receivedAt: order.createdAt,
        startedAt: order.status === 'PREPARING' || order.status === 'READY' || order.status === 'COMPLETED' ? new Date(order.createdAt.getTime() + 60000) : null,
        readyAt: order.status === 'READY' || order.status === 'COMPLETED' ? new Date(order.createdAt.getTime() + 600000) : null,
        completedAt: order.status === 'COMPLETED' ? order.completedAt || new Date() : null,
        items: {
          create: items.map((item) => ({
            saleItemId: item.id,
            menuItemId: item.menuItemId,
            itemNameSnapshot: item.itemNameSnapshot,
            quantity: item.quantity,
            notes: item.notes || null,
            status: order.status === 'COMPLETED' || order.status === 'READY' ? 'READY' : order.status === 'PREPARING' ? 'PREPARING' : 'PENDING',
          })),
        },
      },
    });

    const menuItemIds = items.map((i) => i.menuItemId);
    const stationLinks = await prisma.menuItemStation.findMany({
      where: { menuItemId: { in: menuItemIds } },
      include: { station: true },
    });

    const stationMap = new Map<string, string[]>();
    for (const link of stationLinks) {
      if (!stationMap.has(link.stationId)) {
        stationMap.set(link.stationId, []);
      }
      const item = items.find((i) => i.menuItemId === link.menuItemId);
      if (item) {
        stationMap.get(link.stationId)!.push(item.id);
      }
    }

    if (stationMap.size >= 1) {
      const primaryStationId = Array.from(stationMap.keys())[0];
      await prisma.kitchenTicket.update({
        where: { id: ticket.id },
        data: { stationId: primaryStationId },
      });
    }
  }

  console.log('Kitchen tickets seeded');
}

async function inventorySeed(restaurant: any, westlands: any, kilimani: any) {
  const existingCategoryCount = await prisma.ingredientCategory.count({ where: { restaurantId: restaurant.id } });
  if (existingCategoryCount === 0) {
    const categories = [
      { name: 'Proteins', description: 'Meat, poultry, and seafood', displayOrder: 1 },
      { name: 'Produce', description: 'Fresh fruits and vegetables', displayOrder: 2 },
      { name: 'Dairy', description: 'Milk, cheese, and dairy products', displayOrder: 3 },
      { name: 'Dry Goods', description: 'Flour, rice, spices, and dry ingredients', displayOrder: 4 },
      { name: 'Beverages', description: 'Drinks and beverages', displayOrder: 5 },
      { name: 'Packaging', description: 'Boxes, bags, and packaging materials', displayOrder: 6 },
    ];

    const createdCategories: any = [];
    for (const cat of categories) {
      const created = await prisma.ingredientCategory.create({ data: { ...cat, restaurantId: restaurant.id } });
      createdCategories.push(created);
    }

    console.log('Inventory categories seeded:', createdCategories.map((c: any) => c.name).join(', '));

    const ingredients = [
      { categoryName: 'Proteins', name: 'Chicken Breast', code: 'ING-001', unit: 'kg', costPerUnit: 450, minStockLevel: 10, reorderLevel: 20, available: true },
      { categoryName: 'Proteins', name: 'Beef Steak', code: 'ING-002', unit: 'kg', costPerUnit: 750, minStockLevel: 5, reorderLevel: 10, available: true },
      { categoryName: 'Proteins', name: 'Chicken Wings', code: 'ING-003', unit: 'kg', costPerUnit: 380, minStockLevel: 8, reorderLevel: 15, available: true },
      { categoryName: 'Produce', name: 'Tomatoes', code: 'ING-004', unit: 'kg', costPerUnit: 120, minStockLevel: 15, reorderLevel: 30, available: true },
      { categoryName: 'Produce', name: 'Lettuce', code: 'ING-005', unit: 'pieces', costPerUnit: 30, minStockLevel: 20, reorderLevel: 50, available: true },
      { categoryName: 'Produce', name: 'Onions', code: 'ING-006', unit: 'kg', costPerUnit: 80, minStockLevel: 10, reorderLevel: 20, available: true },
      { categoryName: 'Produce', name: 'Potatoes', code: 'ING-007', unit: 'kg', costPerUnit: 60, minStockLevel: 20, reorderLevel: 40, available: true },
      { categoryName: 'Dairy', name: 'Cheese', code: 'ING-008', unit: 'kg', costPerUnit: 600, minStockLevel: 3, reorderLevel: 6, available: true },
      { categoryName: 'Dairy', name: 'Milk', code: 'ING-009', unit: 'litres', costPerUnit: 90, minStockLevel: 10, reorderLevel: 20, available: true },
      { categoryName: 'Dry Goods', name: 'Burger Buns', code: 'ING-010', unit: 'pieces', costPerUnit: 25, minStockLevel: 50, reorderLevel: 100, available: true },
      { categoryName: 'Dry Goods', name: 'Rice', code: 'ING-011', unit: 'kg', costPerUnit: 150, minStockLevel: 15, reorderLevel: 30, available: true },
      { categoryName: 'Dry Goods', name: 'Flour', code: 'ING-012', unit: 'kg', costPerUnit: 100, minStockLevel: 10, reorderLevel: 20, available: true },
      { categoryName: 'Dry Goods', name: 'Cooking Oil', code: 'ING-013', unit: 'litres', costPerUnit: 200, minStockLevel: 5, reorderLevel: 10, available: true },
      { categoryName: 'Dry Goods', name: 'Spices Mix', code: 'ING-014', unit: 'kg', costPerUnit: 300, minStockLevel: 2, reorderLevel: 5, available: true },
      { categoryName: 'Beverages', name: 'Coke', code: 'ING-015', unit: 'bottles', costPerUnit: 40, minStockLevel: 50, reorderLevel: 100, available: true },
      { categoryName: 'Beverages', name: 'Passion Juice', code: 'ING-016', unit: 'litres', costPerUnit: 120, minStockLevel: 10, reorderLevel: 20, available: true },
      { categoryName: 'Beverages', name: 'Beer', code: 'ING-017', unit: 'bottles', costPerUnit: 150, minStockLevel: 24, reorderLevel: 48, available: true },
      { categoryName: 'Packaging', name: 'Takeaway Boxes', code: 'ING-018', unit: 'pieces', costPerUnit: 10, minStockLevel: 100, reorderLevel: 200, available: true },
      { categoryName: 'Packaging', name: 'Paper Bags', code: 'ING-019', unit: 'pieces', costPerUnit: 5, minStockLevel: 200, reorderLevel: 500, available: true },
      { categoryName: 'Proteins', name: 'Fish', code: 'ING-020', unit: 'kg', costPerUnit: 550, minStockLevel: 5, reorderLevel: 10, available: true },
    ];

    const createdIngredients: any = [];
    for (const ing of ingredients) {
      const category = createdCategories.find((c: any) => c.name === ing.categoryName);
      const existing = await prisma.ingredient.findFirst({ where: { restaurantId: restaurant.id, name: ing.name } });
      let ingredient: any;
      if (!existing) {
        ingredient = await prisma.ingredient.create({
          data: {
            restaurantId: restaurant.id,
            categoryId: category.id,
            name: ing.name,
            code: ing.code,
            unit: ing.unit,
            costPerUnit: ing.costPerUnit,
            minStockLevel: ing.minStockLevel,
            reorderLevel: ing.reorderLevel,
            available: ing.available,
          },
        });
      } else {
        ingredient = existing;
      }
      createdIngredients.push(ingredient);
    }

    console.log('Ingredients seeded:', createdIngredients.length);

    for (const ing of createdIngredients) {
      const westStock = await prisma.inventoryStock.findFirst({ where: { branchId: westlands.id, ingredientId: ing.id } });
      if (!westStock) {
        const qty = Math.floor(Math.random() * 50) + 10;
        await prisma.inventoryStock.create({
          data: {
            restaurantId: restaurant.id,
            branchId: westlands.id,
            ingredientId: ing.id,
            quantity: qty,
            unit: ing.unit,
            costPerUnit: ing.costPerUnit,
            minStockLevel: ing.minStockLevel,
            reorderLevel: ing.reorderLevel,
          },
        });
      }
      const kilStock = await prisma.inventoryStock.findFirst({ where: { branchId: kilimani.id, ingredientId: ing.id } });
      if (!kilStock) {
        const qty = Math.floor(Math.random() * 40) + 5;
        await prisma.inventoryStock.create({
          data: {
            restaurantId: restaurant.id,
            branchId: kilimani.id,
            ingredientId: ing.id,
            quantity: qty,
            unit: ing.unit,
            costPerUnit: ing.costPerUnit,
            minStockLevel: ing.minStockLevel,
            reorderLevel: ing.reorderLevel,
          },
        });
      }
    }

    console.log('Inventory stock seeded');
  } else {
    console.log('Inventory categories already seeded');
    const createdIngredients = await prisma.ingredient.findMany({ where: { restaurantId: restaurant.id } });
    console.log('Ingredients loaded:', createdIngredients.length);
  }

  const manager = await prisma.user.findFirst({ where: { email: 'manager@example.com' } });
  const chef = await prisma.user.findFirst({ where: { email: 'chef@example.com' } });

  const suppliersData = [
    { name: 'Fresh Farm Distributors', contactName: 'James Mwangi', email: 'orders@freshfarm.co.ke', phone: '+254 20 123 456', address: 'Industrial Area, Nairobi', city: 'Nairobi', taxNumber: 'P051234567K', businessRegNumber: 'BRN-0012345', notes: 'Primary produce supplier', status: 'ACTIVE' },
    { name: 'Nairobi Food Supplies', contactName: 'Grace Wambui', email: 'sales@nairobfood.co.ke', phone: '+254 20 654 321', address: 'Kasarani, Nairobi', city: 'Nairobi', taxNumber: 'P056789012K', businessRegNumber: 'BRN-0067890', notes: 'Dry goods and beverages', status: 'ACTIVE' },
    { name: 'Premium Butchery Suppliers', contactName: 'John Kipchoge', email: 'info@premiumbutchery.co.ke', phone: '+254 20 111 222', address: 'Ngong Road, Nairobi', city: 'Nairobi', taxNumber: 'P059988877K', businessRegNumber: 'BRN-0099887', notes: 'Premium meat cuts', status: 'ACTIVE' },
    { name: 'Beverage Hub Kenya', contactName: 'Alice Njoroge', email: 'orders@beveragehub.co.ke', phone: '+254 20 333 444', address: 'South B, Nairobi', city: 'Nairobi', taxNumber: 'P053344455K', businessRegNumber: 'BRN-0033445', notes: 'All beverage categories', status: 'ACTIVE' },
    { name: 'Bakery Wholesale Centre', contactName: 'Peter Kamau', email: 'wholesale@bakerycentre.co.ke', phone: '+254 20 555 666', address: 'Jogoo Road, Nairobi', city: 'Nairobi', taxNumber: 'P057766655K', businessRegNumber: 'BRN-0077665', notes: 'Bakery supplies and packaging', status: 'ACTIVE' },
  ];

  const createdSuppliers: any = [];
  for (const sup of suppliersData) {
    const existing = await prisma.supplier.findFirst({ where: { restaurantId: restaurant.id, name: sup.name } });
    if (!existing) {
      const created = await prisma.supplier.create({ data: { ...sup, restaurantId: restaurant.id } });
      createdSuppliers.push(created);
    } else {
      createdSuppliers.push(existing);
    }
  }

  console.log('Suppliers seeded:', createdSuppliers.length);

  const allIngredients = await prisma.ingredient.findMany({ where: { restaurantId: restaurant.id } });
  const ingredientMap = new Map(allIngredients.map((i: any) => [i.name, i]));

  const supplierIngredientLinks = [
    { supplierName: 'Fresh Farm Distributors', ingredientName: 'Chicken Breast', defaultPurchasePrice: 420, minOrderQuantity: 10 },
    { supplierName: 'Fresh Farm Distributors', ingredientName: 'Tomatoes', defaultPurchasePrice: 110, minOrderQuantity: 20 },
    { supplierName: 'Fresh Farm Distributors', ingredientName: 'Onions', defaultPurchasePrice: 75, minOrderQuantity: 15 },
    { supplierName: 'Fresh Farm Distributors', ingredientName: 'Potatoes', defaultPurchasePrice: 55, minOrderQuantity: 25 },
    { supplierName: 'Nairobi Food Supplies', ingredientName: 'Rice', defaultPurchasePrice: 140, minOrderQuantity: 20 },
    { supplierName: 'Nairobi Food Supplies', ingredientName: 'Flour', defaultPurchasePrice: 95, minOrderQuantity: 20 },
    { supplierName: 'Nairobi Food Supplies', ingredientName: 'Cooking Oil', defaultPurchasePrice: 190, minOrderQuantity: 10 },
    { supplierName: 'Nairobi Food Supplies', ingredientName: 'Coke', defaultPurchasePrice: 38, minOrderQuantity: 50 },
    { supplierName: 'Premium Butchery Suppliers', ingredientName: 'Beef Steak', defaultPurchasePrice: 720, minOrderQuantity: 5 },
    { supplierName: 'Premium Butchery Suppliers', ingredientName: 'Chicken Wings', defaultPurchasePrice: 360, minOrderQuantity: 8 },
    { supplierName: 'Premium Butchery Suppliers', ingredientName: 'Fish', defaultPurchasePrice: 520, minOrderQuantity: 5 },
    { supplierName: 'Beverage Hub Kenya', ingredientName: 'Passion Juice', defaultPurchasePrice: 110, minOrderQuantity: 10 },
    { supplierName: 'Beverage Hub Kenya', ingredientName: 'Beer', defaultPurchasePrice: 140, minOrderQuantity: 24 },
    { supplierName: 'Bakery Wholesale Centre', ingredientName: 'Burger Buns', defaultPurchasePrice: 22, minOrderQuantity: 50 },
    { supplierName: 'Bakery Wholesale Centre', ingredientName: 'Takeaway Boxes', defaultPurchasePrice: 9, minOrderQuantity: 100 },
  ];

  for (const link of supplierIngredientLinks) {
    const supplier = createdSuppliers.find((s: any) => s.name === link.supplierName);
    const ingredient = ingredientMap.get(link.ingredientName);
    if (!supplier || !ingredient) continue;
    const existing = await prisma.supplierIngredient.findUnique({
      where: { supplierId_ingredientId: { supplierId: supplier.id, ingredientId: ingredient.id } },
    });
    if (!existing) {
      await prisma.supplierIngredient.create({
        data: {
          restaurantId: restaurant.id,
          supplierId: supplier.id,
          ingredientId: ingredient.id,
          preferredUnit: ingredient.unit,
          lastPurchasePrice: link.defaultPurchasePrice,
          defaultPurchasePrice: link.defaultPurchasePrice,
          minOrderQuantity: link.minOrderQuantity,
        },
      });
    }
  }

  console.log('Supplier ingredients seeded');

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const twoDaysAgo = new Date(now.getTime() - 86400000 * 2);

  const poDraft = await prisma.purchaseOrder.findFirst({ where: { restaurantId: restaurant.id, status: 'DRAFT' } });
  if (!poDraft) {
    const freshFarm = createdSuppliers.find((s: any) => s.name === 'Fresh Farm Distributors')!;
    const po1 = await prisma.purchaseOrder.create({
      data: {
        restaurantId: restaurant.id,
        branchId: westlands.id,
        supplierId: freshFarm.id,
        orderNumber: `PO-DRAFT-${Date.now()}`,
        orderDate: twoDaysAgo,
        expectedDeliveryDate: new Date(now.getTime() + 86400000),
        status: 'DRAFT',
        subtotal: 5000,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 5000,
        notes: 'Weekly produce restock',
        createdBy: manager.id,
        items: {
          create: [
            { ingredientId: ingredientMap.get('Chicken Breast')!.id, orderedQuantity: 20, unit: 'kg', unitPrice: 420, totalPrice: 8400, tax: 0, discount: 0 },
            { ingredientId: ingredientMap.get('Tomatoes')!.id, orderedQuantity: 30, unit: 'kg', unitPrice: 110, totalPrice: 3300, tax: 0, discount: 0 },
          ],
        },
      },
    });
    console.log('Draft PO seeded');
  }

  const poApproved = await prisma.purchaseOrder.findFirst({ where: { restaurantId: restaurant.id, status: 'APPROVED' } });
  if (!poApproved) {
    const nairobiFood = createdSuppliers.find((s: any) => s.name === 'Nairobi Food Supplies')!;
    const po2 = await prisma.purchaseOrder.create({
      data: {
        restaurantId: restaurant.id,
        branchId: kilimani.id,
        supplierId: nairobiFood.id,
        orderNumber: `PO-APPROVED-${Date.now()}`,
        orderDate: yesterday,
        expectedDeliveryDate: now,
        status: 'APPROVED',
        subtotal: 3000,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 3000,
        notes: 'Dry goods order',
        createdBy: manager.id,
        approvedBy: manager.id,
        approvedAt: new Date(now.getTime() - 3600000),
        items: {
          create: [
            { ingredientId: ingredientMap.get('Rice')!.id, orderedQuantity: 20, unit: 'kg', unitPrice: 140, totalPrice: 2800, tax: 0, discount: 0 },
            { ingredientId: ingredientMap.get('Flour')!.id, orderedQuantity: 15, unit: 'kg', unitPrice: 95, totalPrice: 1425, tax: 0, discount: 0 },
          ],
        },
      },
    });
    console.log('Approved PO seeded');
  }

  const poPartial = await prisma.purchaseOrder.findFirst({ where: { restaurantId: restaurant.id, status: 'PARTIALLY_RECEIVED' } });
  if (!poPartial) {
    const premiumButchery = createdSuppliers.find((s: any) => s.name === 'Premium Butchery Suppliers')!;
    const po3 = await prisma.purchaseOrder.create({
      data: {
        restaurantId: restaurant.id,
        branchId: westlands.id,
        supplierId: premiumButchery.id,
        orderNumber: `PO-PARTIAL-${Date.now()}`,
        orderDate: twoDaysAgo,
        expectedDeliveryDate: yesterday,
        status: 'PARTIALLY_RECEIVED',
        subtotal: 2000,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 2000,
        notes: 'Partial delivery received',
        createdBy: manager.id,
        approvedBy: manager.id,
        approvedAt: new Date(now.getTime() - 86400000),
        receivedAt: new Date(now.getTime() - 43200000),
        items: {
          create: [
            { ingredientId: ingredientMap.get('Beef Steak')!.id, orderedQuantity: 10, receivedQuantity: 6, unit: 'kg', unitPrice: 720, totalPrice: 7200, tax: 0, discount: 0 },
            { ingredientId: ingredientMap.get('Chicken Wings')!.id, orderedQuantity: 8, receivedQuantity: 0, unit: 'kg', unitPrice: 360, totalPrice: 2880, tax: 0, discount: 0 },
          ],
        },
      },
    });

    const beefItem = await prisma.purchaseOrderItem.findFirst({ where: { purchaseOrderId: po3.id, ingredientId: ingredientMap.get('Beef Steak')!.id } });
    if (beefItem) {
      await prisma.stockMovement.create({
        data: {
          restaurantId: restaurant.id,
          branchId: westlands.id,
          ingredientId: ingredientMap.get('Beef Steak')!.id,
          quantity: 6,
          unit: 'kg',
          type: 'PURCHASE',
          reason: `Received PO ${po3.orderNumber} (partial)`,
          referenceId: po3.id,
          referenceType: 'PurchaseOrder',
          userId: manager.id,
        },
      });
      const stock = await prisma.inventoryStock.findFirst({ where: { branchId: westlands.id, ingredientId: ingredientMap.get('Beef Steak')!.id } });
      if (stock) {
        const newQty = stock.quantity + 6;
        const newCost = newQty > 0 ? ((stock.quantity * stock.costPerUnit) + (6 * 720)) / newQty : stock.costPerUnit;
        await prisma.inventoryStock.update({ where: { id: stock.id }, data: { quantity: newQty, costPerUnit: newCost, lastRestockedAt: new Date(now.getTime() - 43200000) } });
      }
    }
    console.log('Partially received PO seeded');
  }

  const poReceived = await prisma.purchaseOrder.findFirst({ where: { restaurantId: restaurant.id, status: 'RECEIVED' } });
  if (!poReceived) {
    const bakery = createdSuppliers.find((s: any) => s.name === 'Bakery Wholesale Centre')!;
    const po4 = await prisma.purchaseOrder.create({
      data: {
        restaurantId: restaurant.id,
        branchId: westlands.id,
        supplierId: bakery.id,
        orderNumber: `PO-RECEIVED-${Date.now()}`,
        orderDate: new Date(now.getTime() - 172800000),
        expectedDeliveryDate: new Date(now.getTime() - 86400000),
        status: 'RECEIVED',
        subtotal: 1500,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 1500,
        notes: 'Completed order',
        createdBy: manager.id,
        approvedBy: manager.id,
        approvedAt: new Date(now.getTime() - 172800000),
        receivedAt: new Date(now.getTime() - 86400000),
        items: {
          create: [
            { ingredientId: ingredientMap.get('Burger Buns')!.id, orderedQuantity: 100, receivedQuantity: 100, unit: 'pieces', unitPrice: 22, totalPrice: 2200, tax: 0, discount: 0 },
            { ingredientId: ingredientMap.get('Takeaway Boxes')!.id, orderedQuantity: 200, receivedQuantity: 200, unit: 'pieces', unitPrice: 9, totalPrice: 1800, tax: 0, discount: 0 },
          ],
        },
      },
    });

    for (const item of await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: po4.id } })) {
      await prisma.stockMovement.create({
        data: {
          restaurantId: restaurant.id,
          branchId: westlands.id,
          ingredientId: item.ingredientId,
          quantity: item.receivedQuantity,
          unit: item.unit,
          type: 'PURCHASE',
          reason: `Received PO ${po4.orderNumber}`,
          referenceId: po4.id,
          referenceType: 'PurchaseOrder',
          userId: manager.id,
        },
      });
      const stock = await prisma.inventoryStock.findFirst({ where: { branchId: westlands.id, ingredientId: item.ingredientId } });
      if (stock) {
        const newQty = stock.quantity + item.receivedQuantity;
        const newCost = newQty > 0 ? ((stock.quantity * stock.costPerUnit) + (item.receivedQuantity * item.unitPrice)) / newQty : stock.costPerUnit;
        await prisma.inventoryStock.update({ where: { id: stock.id }, data: { quantity: newQty, costPerUnit: newCost, lastRestockedAt: po4.receivedAt } });
      }
    }
    console.log('Received PO seeded');
  }

  const poCancelled = await prisma.purchaseOrder.findFirst({ where: { restaurantId: restaurant.id, status: 'CANCELLED' } });
  if (!poCancelled) {
    const beverageHub = createdSuppliers.find((s: any) => s.name === 'Beverage Hub Kenya')!;
    await prisma.purchaseOrder.create({
      data: {
        restaurantId: restaurant.id,
        branchId: kilimani.id,
        supplierId: beverageHub.id,
        orderNumber: `PO-CANCELLED-${Date.now()}`,
        orderDate: new Date(now.getTime() - 259200000),
        expectedDeliveryDate: new Date(now.getTime() - 172800000),
        status: 'CANCELLED',
        subtotal: 1000,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 1000,
        notes: 'Cancelled due to duplicate',
        createdBy: manager.id,
        items: {
          create: [
            { ingredientId: ingredientMap.get('Passion Juice')!.id, orderedQuantity: 10, unit: 'litres', unitPrice: 110, totalPrice: 1100, tax: 0, discount: 0 },
          ],
        },
      },
    });
    console.log('Cancelled PO seeded');
  }

  const correction = await prisma.purchaseCorrection.findFirst({ where: { restaurantId: restaurant.id } });
  if (!correction && poPartial) {
    const partialBeefItem = await prisma.purchaseOrderItem.findFirst({ where: { purchaseOrderId: poPartial.id, ingredientId: ingredientMap.get('Beef Steak')!.id } });
    if (partialBeefItem) {
      await prisma.purchaseCorrection.create({
        data: {
          restaurantId: restaurant.id,
          purchaseOrderId: poPartial.id,
          purchaseOrderItemId: partialBeefItem.id,
          type: 'DAMAGE',
          quantity: 1,
          unit: 'kg',
          reason: 'Packaging damage on arrival',
          notes: 'Adjusted for damaged beef',
          createdBy: manager.id,
        },
      });
      const stock = await prisma.inventoryStock.findFirst({ where: { branchId: westlands.id, ingredientId: ingredientMap.get('Beef Steak')!.id } });
      if (stock) {
        const newQty = Math.max(0, stock.quantity - 1);
        await prisma.inventoryStock.update({ where: { id: stock.id }, data: { quantity: newQty } });
        await prisma.stockMovement.create({
          data: {
            restaurantId: restaurant.id,
            branchId: westlands.id,
            ingredientId: ingredientMap.get('Beef Steak')!.id,
            quantity: -1,
            unit: 'kg',
            type: 'WASTAGE',
            reason: 'Damage from PO',
            referenceId: poPartial.id,
            referenceType: 'PurchaseCorrection',
            userId: manager.id,
            notes: 'Corrected 1kg damaged beef',
          },
        });
      }
      console.log('Purchase correction seeded');
    }
  }

  console.log('Phase 7 suppliers and purchasing seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
