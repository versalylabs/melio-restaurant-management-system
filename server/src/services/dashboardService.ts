import prisma from '../config/database';
import { getRestaurantTimeZone, startOfLocalDay, zonedParts } from '../utils/timezone';
import { safeErrorMessage } from '../utils/safeError';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';

/** Restaurant-local calendar day ("YYYY-MM-DD") of an instant. */
const dayKey = (date: Date, timeZone: string) => {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

export const getDashboardMetrics = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const restaurantId = req.user?.restaurantId;
    const branchId = req.user?.branchId;
    if (!restaurantId) {
      return sendError(res, 'Authentication required', undefined, 401);
    }

    const scoped = (extra: any = {}) => ({ restaurantId, ...(branchId ? { branchId } : {}), ...extra });

    // "Today" and the 7-day trend use the restaurant's local days, not the
    // server's UTC clock (which is 3 hours behind Nairobi).
    const timeZone = await getRestaurantTimeZone(restaurantId);
    const today = startOfLocalDay(timeZone);
    const trendStart = new Date(today.getTime() - 6 * 86_400_000);

    // Run independent metric queries with safe fallbacks
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
      salesForOrderTypes,
      saleItemsForTop,
    ] = await Promise.all([
      prisma.user.count({ where: scoped({ status: 'ACTIVE' }) }).catch(() => 0),
      prisma.branch.count({ where: branchId ? { id: branchId, restaurantId, status: 'ACTIVE' } : { restaurantId, status: 'ACTIVE' } }).catch(() => 0),
      prisma.role.count().catch(() => 0),
      prisma.menuItem.count({ where: { restaurantId } }).catch(() => 0),
      prisma.menuItem.count({ where: { restaurantId, status: 'ACTIVE', available: true } }).catch(() => 0),
      prisma.menuItem.count({ where: { restaurantId, status: 'ACTIVE', available: false } }).catch(() => 0),
      prisma.menuCategory.count({ where: { restaurantId, status: 'ACTIVE' } }).catch(() => 0),
      prisma.menuItemBranch.findMany({
        where: { menuItem: { restaurantId, status: 'ACTIVE', available: true }, ...(branchId ? { branchId } : {}) },
        select: { branchId: true }, distinct: ['branchId'],
      }).catch(() => []),
      prisma.table.count({ where: scoped({ status: { not: 'INACTIVE' } }) }).catch(() => 0),
      prisma.table.count({ where: scoped({ status: 'AVAILABLE' }) }).catch(() => 0),
      prisma.table.count({ where: scoped({ status: 'OCCUPIED' }) }).catch(() => 0),
      prisma.table.count({ where: scoped({ status: 'RESERVED' }) }).catch(() => 0),
      prisma.table.count({ where: scoped({ status: 'CLEANING' }) }).catch(() => 0),
      prisma.table.count({ where: scoped({ status: 'OUT_OF_SERVICE' }) }).catch(() => 0),
      prisma.sale.count({ where: scoped({ createdAt: { gte: today } }) }).catch(() => 0),
      prisma.sale.aggregate({ where: scoped({ status: 'COMPLETED', createdAt: { gte: today } }), _sum: { totalAmount: true } }).catch(() => ({ _sum: { totalAmount: 0 } })),
      prisma.sale.count({ where: scoped({ status: { in: ['DRAFT', 'HELD', 'SUBMITTED', 'PREPARING', 'READY', 'SERVED'] } }) }).catch(() => 0),
      prisma.sale.aggregate({ where: scoped({ status: 'COMPLETED' }), _avg: { totalAmount: true } }).catch(() => ({ _avg: { totalAmount: 0 } })),
      prisma.customer.count({ where: { restaurantId } }).catch(() => 0),
      prisma.auditLog.findMany({
        where: { restaurantId }, take: 6, orderBy: { createdAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true } } },
      }).catch(() => []),
      prisma.sale.findMany({
        where: scoped(), take: 6, orderBy: { createdAt: 'desc' },
        select: { id: true, orderNumber: true, customerName: true, status: true, totalAmount: true, orderType: true, createdAt: true, items: { select: { itemNameSnapshot: true, quantity: true }, take: 3 } },
      }).catch(() => []),
      prisma.sale.findMany({
        where: scoped({ status: 'COMPLETED', createdAt: { gte: trendStart } }),
        select: { createdAt: true, totalAmount: true }, orderBy: { createdAt: 'asc' },
      }).catch(() => []),
      prisma.sale.findMany({
        where: scoped({ createdAt: { gte: trendStart } }),
        select: { orderType: true },
      }).catch(() => []),
      prisma.saleItem.findMany({
        where: { sale: scoped({ status: 'COMPLETED', createdAt: { gte: trendStart } }) },
        select: { menuItemId: true, quantity: true },
      }).catch(() => []),
    ]);

    const todaySales = Number((completedToday as any)._sum?.totalAmount || 0);
    const averageOrderValue = Number((allCompleted as any)._avg?.totalAmount || 0);

    const trendMap = new Map<string, { sales: number; orders: number }>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(trendStart.getTime() + i * 86_400_000 + 12 * 3_600_000);
      trendMap.set(dayKey(d, timeZone), { sales: 0, orders: 0 });
    }
    trendCompletedSales.forEach((sale: any) => {
      const row = trendMap.get(dayKey(new Date(sale.createdAt), timeZone));
      if (row) {
        row.sales += Number(sale.totalAmount || 0);
        row.orders += 1;
      }
    });
    const salesTrend = Array.from(trendMap.entries()).map(([date, value]) => ({ date, ...value }));

    // Aggregate order types safely in JavaScript
    const orderTypeMap = new Map<string, number>();
    salesForOrderTypes.forEach((s: any) => {
      const type = s.orderType || 'DINE_IN';
      orderTypeMap.set(type, (orderTypeMap.get(type) || 0) + 1);
    });
    const orderTypes = Array.from(orderTypeMap.entries()).map(([type, count]) => ({ type, count }));

    // Aggregate top menu items safely in JavaScript
    const itemQuantityMap = new Map<string, number>();
    saleItemsForTop.forEach((si: any) => {
      if (si.menuItemId) {
        itemQuantityMap.set(si.menuItemId, (itemQuantityMap.get(si.menuItemId) || 0) + (si.quantity || 1));
      }
    });
    const sortedTopItemIds = Array.from(itemQuantityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topItemIds = sortedTopItemIds.map(([id]) => id);
    const menuItems = topItemIds.length
      ? await prisma.menuItem.findMany({ where: { id: { in: topItemIds }, restaurantId }, select: { id: true, name: true, image: true, sellingPrice: true } }).catch(() => [])
      : [];
    const itemMap = new Map(menuItems.map((i: any) => [i.id, i]));
    const topMenuItems = sortedTopItemIds.map(([id, quantity]) => {
      const item = itemMap.get(id);
      return { id, name: item?.name || 'Menu item', image: item?.image || null, price: item?.sellingPrice || 0, quantity };
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
      orderTypes,
      topMenuItems,
      recentOrders: recentOrdersRaw,
      recentActivity: recentAuditLogs.map((log: any) => ({
        id: log.id, action: log.action, entity: log.entity, description: log.description,
        userName: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System', createdAt: log.createdAt,
      })),
    });
  } catch (err: any) {
    console.error('getDashboardMetrics error:', err);
    return sendError(res, safeErrorMessage(err, 'Failed to load dashboard'), undefined, 500);
  }
};
