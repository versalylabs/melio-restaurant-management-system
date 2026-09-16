import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse } from '../utils/response';
import { Response as ExpressResponse } from 'express';

const dayKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getDashboardMetrics = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId;
  const scoped = (extra: any = {}) => ({ restaurantId, ...(branchId ? { branchId } : {}), ...extra });

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const trendStart = new Date(today);
  trendStart.setDate(trendStart.getDate() - 6);

  const [
    totalUsers,
    totalBranches,
    totalRoles,
    totalMenuItems,
    activeMenuItems,
    unavailableItems,
    totalCategories,
    branchesWithActiveMenus,
    totalTables,
    availableTables,
    occupiedTables,
    reservedTables,
    cleaningTables,
    outOfServiceTables,
    todayOrders,
    completedToday,
    activeOrders,
    allCompleted,
    totalCustomers,
    recentAuditLogs,
    recentOrdersRaw,
    trendCompletedSales,
    orderTypeRows,
    topItemRows,
  ] = await Promise.all([
    prisma.user.count({ where: scoped({ status: 'ACTIVE' }) }),
    prisma.branch.count({ where: branchId ? { id: branchId, restaurantId, status: 'ACTIVE' } : { restaurantId, status: 'ACTIVE' } }),
    prisma.role.count(),
    prisma.menuItem.count({ where: { restaurantId } }),
    prisma.menuItem.count({ where: { restaurantId, status: 'ACTIVE', available: true } }),
    prisma.menuItem.count({ where: { restaurantId, status: 'ACTIVE', available: false } }),
    prisma.menuCategory.count({ where: { restaurantId, status: 'ACTIVE' } }),
    prisma.menuItemBranch.findMany({
      where: { menuItem: { restaurantId, status: 'ACTIVE', available: true }, ...(branchId ? { branchId } : {}) },
      select: { branchId: true }, distinct: ['branchId'],
    }),
    prisma.table.count({ where: scoped({ status: { not: 'INACTIVE' } }) }),
    prisma.table.count({ where: scoped({ status: 'AVAILABLE' }) }),
    prisma.table.count({ where: scoped({ status: 'OCCUPIED' }) }),
    prisma.table.count({ where: scoped({ status: 'RESERVED' }) }),
    prisma.table.count({ where: scoped({ status: 'CLEANING' }) }),
    prisma.table.count({ where: scoped({ status: 'OUT_OF_SERVICE' }) }),
    prisma.sale.count({ where: scoped({ createdAt: { gte: today } }) }),
    prisma.sale.findMany({ where: scoped({ status: 'COMPLETED', createdAt: { gte: today } }), select: { totalAmount: true } }),
    prisma.sale.count({ where: scoped({ status: { in: ['DRAFT', 'HELD', 'SUBMITTED', 'PREPARING', 'READY', 'SERVED'] } }) }),
    prisma.sale.findMany({ where: scoped({ status: 'COMPLETED' }), select: { totalAmount: true } }),
    prisma.customer.count({ where: { restaurantId } }),
    prisma.auditLog.findMany({
      where: { restaurantId }, take: 6, orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.sale.findMany({
      where: scoped(), take: 6, orderBy: { createdAt: 'desc' },
      select: { id: true, orderNumber: true, customerName: true, status: true, totalAmount: true, orderType: true, createdAt: true, items: { select: { itemNameSnapshot: true, quantity: true }, take: 3 } },
    }),
    prisma.sale.findMany({
      where: scoped({ status: 'COMPLETED', createdAt: { gte: trendStart } }),
      select: { createdAt: true, totalAmount: true }, orderBy: { createdAt: 'asc' },
    }),
    prisma.sale.groupBy({ by: ['orderType'], where: scoped({ createdAt: { gte: trendStart } }), _count: { _all: true } }),
    prisma.saleItem.groupBy({
      by: ['menuItemId'],
      where: { sale: { is: scoped({ status: 'COMPLETED', createdAt: { gte: trendStart } }) } },
      _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 5,
    }),
  ]);

  const todaySales = completedToday.reduce((sum, order) => sum + order.totalAmount, 0);
  const averageOrderValue = allCompleted.length ? allCompleted.reduce((sum, o) => sum + o.totalAmount, 0) / allCompleted.length : 0;

  const trendMap = new Map<string, { sales: number; orders: number }>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(trendStart); d.setDate(trendStart.getDate() + i);
    trendMap.set(dayKey(d), { sales: 0, orders: 0 });
  }
  trendCompletedSales.forEach((sale) => {
    const row = trendMap.get(dayKey(sale.createdAt));
    if (row) {
      row.sales += Number(sale.totalAmount || 0);
      row.orders += 1;
    }
  });
  const salesTrend = Array.from(trendMap.entries()).map(([date, value]) => ({ date, ...value }));

  const topItemIds = topItemRows.map((r) => r.menuItemId);
  const menuItems = topItemIds.length ? await prisma.menuItem.findMany({ where: { id: { in: topItemIds }, restaurantId }, select: { id: true, name: true, image: true, sellingPrice: true } }) : [];
  const itemMap = new Map(menuItems.map((i) => [i.id, i]));
  const topMenuItems = topItemRows.map((row) => {
    const item = itemMap.get(row.menuItemId);
    return { id: row.menuItemId, name: item?.name || 'Menu item', image: item?.image || null, price: item?.sellingPrice || 0, quantity: row._sum.quantity || 0 };
  });

  const metrics = {
    totalUsers, totalBranches, totalRoles, totalMenuItems, activeMenuItems, unavailableItems, totalCategories,
    branchesWithActiveMenus: branchesWithActiveMenus.length, totalTables, availableTables, occupiedTables, reservedTables,
    cleaningTables, outOfServiceTables, todaySales, todayOrders, totalCustomers, lowStock: 0, pendingOrders: activeOrders,
    averageOrderValue,
  };

  return sendResponse(res, true, 'Dashboard metrics retrieved', {
    metrics,
    salesTrend,
    orderTypes: orderTypeRows.map((row) => ({ type: row.orderType || 'OTHER', count: row._count._all })),
    topMenuItems,
    recentOrders: recentOrdersRaw,
    recentActivity: recentAuditLogs.map((log) => ({
      id: log.id, action: log.action, entity: log.entity, description: log.description,
      userName: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System', createdAt: log.createdAt,
    })),
  });
};
