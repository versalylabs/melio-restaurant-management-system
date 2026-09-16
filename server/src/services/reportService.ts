import prisma from '../config/database';

function rangeDates(startDate?: string, endDate?: string) {
  const end = endDate ? new Date(`${endDate}T23:59:59.999`) : new Date();
  const start = startDate ? new Date(`${startDate}T00:00:00.000`) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function buildSalesReport(restaurantId: string, options: { startDate?: string; endDate?: string; branchId?: string } = {}) {
  const { start, end } = rangeDates(options.startDate, options.endDate);
  const where: any = { restaurantId, createdAt: { gte: start, lte: end }, status: 'COMPLETED' };
  if (options.branchId) where.branchId = options.branchId;

  const sales = await prisma.sale.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
      items: true,
      payments: { where: { status: 'COMPLETED' }, select: { method: true, amount: true } },
      promotion: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // SaleItem intentionally stores a menuItemId without a Prisma relation.
  // Load the referenced menu items separately so reports can still calculate
  // product/category performance and estimated cost without changing the schema.
  const menuItemIds = [...new Set(sales.flatMap((sale) => sale.items.map((item) => item.menuItemId)))];
  const menuItems = menuItemIds.length
    ? await prisma.menuItem.findMany({
        where: { id: { in: menuItemIds }, restaurantId },
        select: { id: true, name: true, costPrice: true, category: { select: { id: true, name: true } } },
      })
    : [];
  const menuItemById = new Map(menuItems.map((item) => [item.id, item]));

  // Sale.createdBy is a scalar field (there is no Prisma relation on Sale),
  // so load the cashier records separately instead of using an invalid include.
  const creatorIds = [...new Set(sales.map((sale) => sale.createdBy).filter(Boolean))];
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds }, restaurantId },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const creatorById = new Map(creators.map((user) => [user.id, user]));

  let grossSales = 0;
  let totalDiscounts = 0;
  let totalTax = 0;
  let totalServiceCharge = 0;
  let totalCost = 0;
  const byProduct = new Map<string, any>();
  const byCategory = new Map<string, any>();
  const byCashier = new Map<string, any>();
  const byBranch = new Map<string, any>();
  const byPaymentMethod = new Map<string, any>();
  const customerSpend = new Map<string, any>();
  const byPromotion = new Map<string, any>();

  for (const sale of sales as any[]) {
    grossSales += sale.totalAmount;
    totalDiscounts += sale.discountAmount || 0;
    totalTax += sale.taxAmount || 0;
    totalServiceCharge += sale.serviceChargeAmount || 0;
    if (sale.promotionId && sale.promotion) { const pr = byPromotion.get(sale.promotionId) || { id: sale.promotionId, name: sale.promotion.name, orders: 0, discounts: 0 }; pr.orders++; pr.discounts += sale.discountAmount || 0; byPromotion.set(sale.promotionId, pr); }
    const creator = creatorById.get(sale.createdBy);
    const cashier = creator ? `${creator.firstName} ${creator.lastName}` : 'Unknown';
    const c = byCashier.get(sale.createdBy) || { id: sale.createdBy, name: cashier, orders: 0, sales: 0 };
    c.orders++; c.sales += sale.totalAmount; byCashier.set(sale.createdBy, c);
    const b = byBranch.get(sale.branchId) || { id: sale.branchId, name: sale.branch?.name || 'Unknown', orders: 0, sales: 0 };
    b.orders++; b.sales += sale.totalAmount; byBranch.set(sale.branchId, b);
    if (sale.customerId) {
      const cs = customerSpend.get(sale.customerId) || { id: sale.customerId, name: sale.customer?.name || sale.customerName || 'Customer', orders: 0, spent: 0 };
      cs.orders++; cs.spent += sale.totalAmount; customerSpend.set(sale.customerId, cs);
    }
    for (const p of sale.payments) {
      const pm = byPaymentMethod.get(p.method) || { method: p.method, amount: 0, transactions: 0 };
      pm.amount += p.amount; pm.transactions++; byPaymentMethod.set(p.method, pm);
    }
    for (const item of sale.items as any[]) {
      const menuItem = menuItemById.get(item.menuItemId);
      const cost = (menuItem?.costPrice || 0) * item.quantity;
      totalCost += cost;
      const product = byProduct.get(item.menuItemId) || { id: item.menuItemId, name: menuItem?.name || item.itemNameSnapshot, quantity: 0, sales: 0, cost: 0 };
      product.quantity += item.quantity; product.sales += item.subtotal; product.cost += cost; byProduct.set(item.menuItemId, product);
      const categoryId = menuItem?.category?.id || 'uncategorized';
      const category = byCategory.get(categoryId) || { id: categoryId, name: menuItem?.category?.name || 'Uncategorized', quantity: 0, sales: 0, cost: 0 };
      category.quantity += item.quantity; category.sales += item.subtotal; category.cost += cost; byCategory.set(categoryId, category);
    }
  }

  const orderCount = sales.length;
  const averageOrderValue = orderCount ? grossSales / orderCount : 0;
  const grossProfitEstimate = grossSales - totalCost;
  return {
    period: { startDate: start.toISOString(), endDate: end.toISOString() },
    summary: { orderCount, grossSales, totalDiscounts, totalTax, totalServiceCharge, totalCost, grossProfitEstimate, averageOrderValue },
    byProduct: [...byProduct.values()].sort((a,b) => b.sales-a.sales),
    byCategory: [...byCategory.values()].sort((a,b) => b.sales-a.sales),
    byCashier: [...byCashier.values()].sort((a,b) => b.sales-a.sales),
    byBranch: [...byBranch.values()].sort((a,b) => b.sales-a.sales),
    byPaymentMethod: [...byPaymentMethod.values()].sort((a,b) => b.amount-a.amount),
    customerSpending: [...customerSpend.values()].sort((a,b) => b.spent-a.spent).slice(0, 100),
    byPromotion: [...byPromotion.values()].sort((a,b) => b.discounts-a.discounts),
    orders: sales.map((s: any) => {
      const paid = (s.payments || []).reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
      const paymentStatus = paid <= 0 ? 'UNPAID' : paid + 0.005 >= s.totalAmount ? 'PAID' : 'PARTIAL';
      const creator = creatorById.get(s.createdBy);
      return {
        id: s.id,
        orderNumber: s.orderNumber,
        date: s.createdAt,
        branch: s.branch?.name,
        cashier: creator ? `${creator.firstName} ${creator.lastName}` : 'Unknown',
        customer: s.customer?.name || s.customerName || 'Walk-in',
        total: s.totalAmount,
        paymentStatus,
      };
    })
  };
}

export function toCsv(rows: any[], columns: Array<{ key: string; label: string }>) {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [columns.map(c => esc(c.label)).join(','), ...rows.map(row => columns.map(c => esc(row[c.key])).join(','))].join('\n');
}
