import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';
import { calculateOrderTotals, OrderCalculationInput } from './orderCalculationService';
import { createKitchenTicketForOrder } from './kitchenService';
import { completeOrder } from './orderCompletionService';
import { validatePromotion } from './promotionService';
import { deductInventoryForOrder } from './inventoryService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';

export interface CreateOrderItem {
  menuItemId: string;
  itemNameSnapshot: string;
  unitPrice: number;
  quantity: number;
  notes?: string;
  modifiers: Array<{
    modifierOptionId: string;
    optionNameSnapshot: string;
    priceAdjustment: number;
  }>;
}

export const getOrders = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { status, orderType, search, page = '1', limit = '20', startDate, endDate } = req.query;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (status) where.status = status as string;
  if (orderType) where.orderType = orderType as string;
  if (search) {
    where.OR = [
      { orderNumber: { contains: search as string } },
      { customerName: { contains: search as string } },
    ];
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }

  const [orders, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: { include: { modifiers: true } },
        payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  return sendResponse(res, true, 'Orders retrieved', {
    orders: orders.map((o) => {
      const calculatedAmountPaid = o.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const calculatedPaymentStatus = calculatedAmountPaid <= 0
        ? 'UNPAID'
        : calculatedAmountPaid + 0.005 < o.totalAmount
          ? 'PARTIAL'
          : 'PAID';
      return {
        id: o.id,
      orderNumber: o.orderNumber,
      orderType: o.orderType,
      tableId: o.tableId,
      tableNumber: o.table?.tableNumber,
      tableName: o.table?.name,
      customerName: o.customerName,
      status: o.status,
      paymentStatus: calculatedPaymentStatus,
      amountPaid: calculatedAmountPaid,
      subtotal: o.subtotal,
      discountAmount: o.discountAmount,
      taxAmount: o.taxAmount,
      serviceChargeAmount: o.serviceChargeAmount,
      totalAmount: o.totalAmount,
      notes: o.notes,
      createdBy: o.createdBy,
      completedAt: o.completedAt,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      branchId: o.branchId,
      branchName: o.branch.name,
      branchCode: o.branch.code,
      itemCount: o.items.length,
      createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    }),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const order = await prisma.sale.findFirst({
    where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      table: { select: { id: true, tableNumber: true, name: true, capacity: true } },
      items: {
        include: {
          modifiers: true,
        },
      },
      statusHistory: { orderBy: { createdAt: 'desc' } },
      payments: { where: { status: 'COMPLETED' }, select: { id: true, method: true, amount: true, amountTendered: true, changeAmount: true, reference: true, createdAt: true } },
      receipt: true,
    },
  });

  if (!order) {
    return sendError(res, 'Order not found', undefined, 404);
  }

  const calculatedAmountPaid = order.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const calculatedPaymentStatus = calculatedAmountPaid <= 0
    ? 'UNPAID'
    : calculatedAmountPaid + 0.005 < order.totalAmount
      ? 'PARTIAL'
      : 'PAID';

  return sendResponse(res, true, 'Order retrieved', {
    ...order,
    amountPaid: calculatedAmountPaid,
    paymentStatus: calculatedPaymentStatus,
    items: order.items.map((item) => ({
      ...item,
      modifiers: item.modifiers,
    })),
  });
};

export const createOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;
  const branchId = req.user!.branchId;

  if (!branchId) {
    return sendError(res, 'User must be assigned to a branch to create orders');
  }

  const {
    orderType,
    tableId,
    customerName,
    customerId,
    items,
    notes,
    discountAmount,
    discountReason,
    promotionId,
    status,
  } = req.body;

  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, restaurantId } });
    if (!customer) return sendError(res, 'Invalid customer');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return sendError(res, 'Order must contain at least one item');
  }

  // Validate quantities
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 500) {
      return sendError(res, 'Item quantity must be a positive integer between 1 and 500');
    }
  }

  const menuItemIds = [...new Set(items.map((item: any) => String(item.menuItemId || '')))];
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, restaurantId, status: 'ACTIVE' },
    select: { id: true, name: true, sellingPrice: true, available: true },
  });
  if (menuItems.length !== menuItemIds.length) {
    return sendError(res, 'One or more menu items are invalid or inactive');
  }
  const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]));

  // Collect all modifier option IDs
  const allModifierOptionIds: string[] = [];
  for (const item of items) {
    for (const mod of item.modifiers || []) {
      if (mod.modifierOptionId) allModifierOptionIds.push(String(mod.modifierOptionId));
    }
  }
  const uniqueModIds = [...new Set(allModifierOptionIds)];
  let modifierOptionMap = new Map<string, { id: string; name: string; priceAdjustment: number }>();
  if (uniqueModIds.length > 0) {
    const dbModOptions = await prisma.modifierOption.findMany({
      where: { id: { in: uniqueModIds }, status: 'ACTIVE' },
      select: { id: true, name: true, priceAdjustment: true },
    });
    if (dbModOptions.length !== uniqueModIds.length) {
      return sendError(res, 'One or more modifier options are invalid or inactive');
    }
    modifierOptionMap = new Map(dbModOptions.map((o) => [o.id, o]));
  }

  // Authoritatively construct normalized items
  const normalizedItems = items.map((item: any) => {
    const dbItem = menuItemMap.get(item.menuItemId)!;
    const itemMods = (item.modifiers || []).map((m: any) => {
      const dbMod = modifierOptionMap.get(m.modifierOptionId)!;
      return {
        modifierOptionId: dbMod.id,
        optionNameSnapshot: dbMod.name,
        priceAdjustment: dbMod.priceAdjustment,
      };
    });
    return {
      menuItemId: dbItem.id,
      itemNameSnapshot: dbItem.name,
      unitPrice: dbItem.sellingPrice,
      quantity: Math.floor(Number(item.quantity)),
      notes: item.notes ? String(item.notes).trim() : undefined,
      modifiers: itemMods,
    };
  });

  const validStatuses = ['DRAFT', 'HELD', 'SUBMITTED'];
  const finalStatus = status && validStatuses.includes(status) ? status : 'DRAFT';

  if (orderType === 'DINE_IN' && !tableId) {
    return sendError(res, 'Table is required for dine-in orders');
  }

  if (tableId) {
    const table = await prisma.table.findFirst({
      where: { id: tableId, branchId, restaurantId, status: { not: 'INACTIVE' } },
    });
    if (!table) {
      return sendError(res, 'Invalid table for this branch');
    }
    if (finalStatus === 'SUBMITTED' && table.status === 'OUT_OF_SERVICE') {
      return sendError(res, 'Cannot submit order for out-of-service table');
    }
  }

  let promotion: any = undefined;
  const baseSubtotal = normalizedItems.reduce(
    (sum: number, item: any) =>
      sum +
      (item.unitPrice + item.modifiers.reduce((m: number, mod: any) => m + mod.priceAdjustment, 0)) *
        item.quantity,
    0
  );
  if (promotionId) {
    promotion = await validatePromotion(promotionId, restaurantId, branchId, customerId, baseSubtotal);
  }
  const role = await prisma.role.findUnique({ where: { id: req.user!.roleId }, select: { maxDiscountPercent: true, maxDiscountAmount: true } });
  if (!promotion && Number(discountAmount || 0) > 0) {
    const isPct = req.body.discountType === 'PERCENTAGE';
    const numDisc = Number(discountAmount);
    if (!Number.isFinite(numDisc) || numDisc < 0) return sendError(res, 'Invalid discount amount');
    if (isPct && numDisc > (role?.maxDiscountPercent ?? 100)) return sendError(res, 'Discount percentage exceeds your approval limit');
    if (!isPct && numDisc > (role?.maxDiscountAmount ?? 1000000)) return sendError(res, 'Discount amount exceeds your approval limit');
  }
  const calculationInput: OrderCalculationInput = {
    items: normalizedItems,
    discountAmount: Math.max(0, Number(discountAmount) || 0),
    discountType: req.body.discountType || 'FIXED',
    restaurantId,
    branchId,
    promotion: promotion ? { discountType: promotion.discountType, value: promotion.value, scope: promotion.scope, menuItemId: promotion.menuItemId, maxDiscountAmount: promotion.maxDiscountAmount } : undefined,
  };

  const totals = await calculateOrderTotals(calculationInput);

  const order = await prisma.$transaction(async (tx) => {
    const counter = await tx.orderCounter.findUnique({
      where: { restaurantId_branchId: { restaurantId, branchId } },
    });

    let nextNumber: number;
    if (counter) {
      nextNumber = counter.lastNumber + 1;
      await tx.orderCounter.update({
        where: { restaurantId_branchId: { restaurantId, branchId } },
        data: { lastNumber: nextNumber },
      });
    } else {
      nextNumber = 1;
      await tx.orderCounter.create({
        data: { restaurantId, branchId, lastNumber: nextNumber },
      });
    }

    const orderNumber = `#${nextNumber}`;

    const newOrder = await tx.sale.create({
      data: {
        orderNumber,
        orderType: orderType || 'DINE_IN',
        customerName: customerName ? String(customerName).trim() : null,
        ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
        status: finalStatus,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        discountReason: discountReason ? String(discountReason).trim() : null,
        discountAppliedBy: (totals.discountAmount > 0 ? userId : null) as any,
        ...(promotionId
          ? { promotion: { connect: { id: promotionId } } }
          : {}),
        taxAmount: totals.taxAmount,
        serviceChargeAmount: totals.serviceChargeAmount,
        totalAmount: totals.totalAmount,
        notes: notes ? String(notes).trim() : null,
        createdBy: userId,
        completedAt: finalStatus === 'COMPLETED' ? new Date() : null,
        cancelledAt: finalStatus === 'CANCELLED' ? new Date() : null,
        cancelReason: finalStatus === 'CANCELLED' ? req.body.cancelReason || null : null,
        cancelledBy: finalStatus === 'CANCELLED' ? userId : null,
        restaurant: { connect: { id: restaurantId } },
        branch: { connect: { id: branchId } },
        ...(tableId ? { table: { connect: { id: tableId } } } : {}),
        items: {
          create: normalizedItems.map((item: any) => ({
            menuItemId: item.menuItemId,
            itemNameSnapshot: item.itemNameSnapshot,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            subtotal: Math.round((item.unitPrice * item.quantity + item.modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment * item.quantity, 0)) * 100) / 100,
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
      include: {
        branch: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: { include: { modifiers: true } },
      },
    });

    if (finalStatus !== 'DRAFT') {
      await tx.saleStatusHistory.create({
        data: {
          saleId: newOrder.id,
          status: finalStatus,
          changedBy: userId,
          notes: `Order created with status ${finalStatus}`,
        },
      });
    }

    return newOrder;
  });

  if (['SUBMITTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'].includes(finalStatus) && order.tableId) {
    await prisma.table.update({
      where: { id: order.tableId },
      data: { status: 'OCCUPIED' },
    });
  }

  if (finalStatus === 'SUBMITTED') {
    await createKitchenTicketForOrder(order.id, restaurantId, branchId);
  }

  if (finalStatus === 'COMPLETED') {
    try {
      await deductInventoryForOrder(order.id, restaurantId, branchId);
    } catch (e) {
      console.error('Inventory deduction failed:', e);
    }
  }

  await createAuditLog(
    restaurantId,
    userId,
    'CREATE',
    'Order',
    order.id,
    `Created order ${order.orderNumber}`
  );

  return sendResponse(res, true, 'Order created successfully', order, 201);
};

export const updateOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.sale.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Order not found', undefined, 404);
  }

  if (['COMPLETED', 'CANCELLED'].includes(existing.status)) {
    return sendError(res, 'Cannot update completed or cancelled order');
  }

  const { notes, discountAmount, discountReason, tableId, orderType, items, promotionId, customerId } = req.body;

  let updateData: any = {};
  if (notes !== undefined) updateData.notes = notes ? String(notes).trim() : null;
  if (tableId !== undefined) updateData.tableId = tableId;
  if (orderType !== undefined) updateData.orderType = orderType;

  if (customerId !== undefined) {
    if (customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, restaurantId } });
      if (!customer) return sendError(res, 'Invalid customer');
    }
    updateData.customerId = customerId || null;
  }

  if (items && Array.isArray(items) && items.length > 0) {
    // Validate quantities
    for (const item of items) {
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 500) {
        return sendError(res, 'Item quantity must be a positive integer between 1 and 500');
      }
    }

    const menuItemIds = [...new Set(items.map((item: any) => String(item.menuItemId || '')))];
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, restaurantId, status: 'ACTIVE' },
      select: { id: true, name: true, sellingPrice: true },
    });
    if (menuItems.length !== menuItemIds.length) {
      return sendError(res, 'One or more menu items are invalid or inactive');
    }
    const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]));

    const allModifierOptionIds: string[] = [];
    for (const item of items) {
      for (const mod of item.modifiers || []) {
        if (mod.modifierOptionId) allModifierOptionIds.push(String(mod.modifierOptionId));
      }
    }
    const uniqueModIds = [...new Set(allModifierOptionIds)];
    let modifierOptionMap = new Map<string, { id: string; name: string; priceAdjustment: number }>();
    if (uniqueModIds.length > 0) {
      const dbModOptions = await prisma.modifierOption.findMany({
        where: { id: { in: uniqueModIds }, status: 'ACTIVE' },
        select: { id: true, name: true, priceAdjustment: true },
      });
      if (dbModOptions.length !== uniqueModIds.length) {
        return sendError(res, 'One or more modifier options are invalid or inactive');
      }
      modifierOptionMap = new Map(dbModOptions.map((o) => [o.id, o]));
    }

    const normalizedItems = items.map((item: any) => {
      const dbItem = menuItemMap.get(item.menuItemId)!;
      const itemMods = (item.modifiers || []).map((m: any) => {
        const dbMod = modifierOptionMap.get(m.modifierOptionId)!;
        return {
          modifierOptionId: dbMod.id,
          optionNameSnapshot: dbMod.name,
          priceAdjustment: dbMod.priceAdjustment,
        };
      });
      return {
        menuItemId: dbItem.id,
        itemNameSnapshot: dbItem.name,
        unitPrice: dbItem.sellingPrice,
        quantity: Math.floor(Number(item.quantity)),
        notes: item.notes ? String(item.notes).trim() : undefined,
        modifiers: itemMods,
      };
    });

    let promotion: any = undefined;
    const effectiveCustomerId = customerId !== undefined ? customerId || undefined : existing.customerId || undefined;
    const effectivePromotionId = promotionId !== undefined ? promotionId || undefined : existing.promotionId || undefined;
    const baseSubtotal = normalizedItems.reduce(
      (sum: number, item: any) =>
        sum +
        (item.unitPrice + item.modifiers.reduce((m: number, mod: any) => m + mod.priceAdjustment, 0)) *
          item.quantity,
      0
    );
    if (effectivePromotionId) {
      promotion = await validatePromotion(effectivePromotionId, restaurantId, existing.branchId, effectiveCustomerId, baseSubtotal);
    }
    const role = await prisma.role.findUnique({ where: { id: req.user!.roleId }, select: { maxDiscountPercent: true, maxDiscountAmount: true } });
    const requestedDiscount = discountAmount !== undefined ? Number(discountAmount || 0) : Number(existing.discountAmount || 0);
    if (!promotion && requestedDiscount > 0) {
      const isPct = req.body.discountType === 'PERCENTAGE';
      if (isPct && requestedDiscount > (role?.maxDiscountPercent ?? 100)) return sendError(res, 'Discount exceeds your approval limit');
      if (!isPct && requestedDiscount > (role?.maxDiscountAmount ?? 1000000)) return sendError(res, 'Discount exceeds your approval limit');
    }
    if (promotionId !== undefined) {
      updateData.promotion = promotionId
        ? { connect: { id: promotionId } }
        : { disconnect: true };
    }
    const calculationInput: OrderCalculationInput = {
      items: normalizedItems,
      discountAmount: requestedDiscount,
      discountType: req.body.discountType || 'FIXED',
      restaurantId,
      branchId: existing.branchId,
      promotion: promotion ? { discountType: promotion.discountType, value: promotion.value, scope: promotion.scope, menuItemId: promotion.menuItemId, maxDiscountAmount: promotion.maxDiscountAmount } : undefined,
    };

    const totals = await calculateOrderTotals(calculationInput);
    updateData.subtotal = totals.subtotal;
    updateData.discountAmount = totals.discountAmount;
    updateData.discountReason = discountReason !== undefined ? (discountReason ? String(discountReason).trim() : null) : existing.discountReason;
    updateData.discountAppliedBy = totals.discountAmount > 0 ? userId : null;
    updateData.taxAmount = totals.taxAmount;
    updateData.serviceChargeAmount = totals.serviceChargeAmount;
    updateData.totalAmount = totals.totalAmount;

    const order = await prisma.$transaction(async (tx) => {
      await tx.saleItem.deleteMany({ where: { saleId: id } });

      return tx.sale.update({
        where: { id },
        data: {
          ...updateData,
          items: {
            create: normalizedItems.map((item: any) => ({
              menuItemId: item.menuItemId,
              itemNameSnapshot: item.itemNameSnapshot,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              subtotal: Math.round((item.unitPrice * item.quantity + item.modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment * item.quantity, 0)) * 100) / 100,
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
        include: {
          branch: { select: { id: true, name: true, code: true } },
          table: { select: { id: true, tableNumber: true, name: true } },
          items: { include: { modifiers: true } },
        },
      });
    });

    await createAuditLog(restaurantId, userId, 'UPDATE', 'Order', id, `Updated order ${order.orderNumber}`);
    return sendResponse(res, true, 'Order updated successfully', order);
  }

  const order = await prisma.sale.update({
    where: { id },
    data: updateData,
    include: {
      branch: { select: { id: true, name: true, code: true } },
      table: { select: { id: true, tableNumber: true, name: true } },
      items: { include: { modifiers: true } },
    },
  });

  await createAuditLog(restaurantId, userId, 'UPDATE', 'Order', id, `Updated order ${order.orderNumber}`);
  return sendResponse(res, true, 'Order updated successfully', order);
};

export const updateOrderStatus = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const validStatuses = ['DRAFT', 'HELD', 'SUBMITTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'SERVED', 'COMPLETED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    return sendError(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const existing = await prisma.sale.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Order not found', undefined, 404);
  }

  if (['COMPLETED', 'CANCELLED'].includes(existing.status)) {
    return sendError(res, `Cannot change status of ${existing.status.toLowerCase()} order`);
  }

  const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ['HELD', 'SUBMITTED', 'CANCELLED'],
    HELD: ['DRAFT', 'SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['OUT_FOR_DELIVERY', 'SERVED', 'COMPLETED', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
    SERVED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  };

  const allowedTransitions = VALID_STATUS_TRANSITIONS[existing.status] || [];
  if (existing.status !== status && !allowedTransitions.includes(status)) {
    return sendError(res, `Cannot change order status from ${existing.status} to ${status}`);
  }

  if (status === 'COMPLETED') {
    try {
      const order = await completeOrder(id, restaurantId, userId);
      await createAuditLog(restaurantId, userId, 'UPDATE', 'Order', id, `Order ${order.orderNumber} status changed to COMPLETED`);
      return sendResponse(res, true, 'Order status updated', order);
    } catch (error: any) {
      if (error?.message === 'ORDER_NOT_FOUND') return sendError(res, 'Order not found', undefined, 404);
      if (error?.message === 'ORDER_CANCELLED') return sendError(res, 'Cannot complete a cancelled order');
      console.error('Complete order failed:', error);
      return sendError(res, 'Unable to complete order.', undefined, 500);
    }
  }

  const order = await prisma.$transaction(async (tx) => {
    const updateData: any = { status, updatedAt: new Date() };

    if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      updateData.cancelReason = req.body.cancelReason || null;
      updateData.cancelledBy = userId;
      if (existing.tableId) {
        const table = await tx.table.findUnique({ where: { id: existing.tableId } });
        if (table && table.status === 'OCCUPIED') {
          await tx.table.update({
            where: { id: existing.tableId },
            data: { status: 'AVAILABLE' },
          });
        }
      }
    }

    const updated = await tx.sale.update({
      where: { id },
      data: updateData,
      include: {
        branch: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: { include: { modifiers: true } },
      },
    });

    await tx.saleStatusHistory.create({
      data: {
        saleId: id,
        status,
        notes: notes || `Status changed to ${status}`,
        changedBy: userId,
      },
    });

    return updated;
  });

  if (status === 'SUBMITTED' && existing.branchId) {
    try {
      await createKitchenTicketForOrder(order.id, restaurantId, existing.branchId);
    } catch (ticketErr) {
      console.error('Kitchen ticket creation error:', ticketErr);
    }
  }

  await createAuditLog(restaurantId, userId, 'UPDATE', 'Order', id, `Order ${order.orderNumber} status changed to ${status}`);

  // Keep online customers synchronized when staff changes an order stage directly.
  realtimeService.broadcast(`orders:${order.branch.id}`, 'order_status_updated', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
  });
  if (['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'SERVED', 'COMPLETED', 'CANCELLED'].includes(status)) {
    const online = await prisma.onlineOrder.findFirst({ where: { saleId: order.id }, include: { restaurant: true } });
    if (online) {
      void notifyCustomerOrderUpdate({
        trackingToken: online.trackingToken,
        orderNumber: order.orderNumber,
        status,
        customerPhone: online.contactPhone,
        customerEmail: online.contactEmail,
        restaurantName: online.restaurant?.name || 'Melio',
        totalAmount: order.totalAmount,
      }).catch((err) => console.error('Order status customer notification failed:', err));
    }
  }
  return sendResponse(res, true, 'Order status updated', order);
};

export const holdOrder = async (req: AuthRequest, res: ExpressResponse) => {
  req.body.status = 'HELD';
  return updateOrderStatus(req, res);
};

export const resumeOrder = async (req: AuthRequest, res: ExpressResponse) => {
  req.body.status = 'DRAFT';
  return updateOrderStatus(req, res);
};

export const submitOrder = async (req: AuthRequest, res: ExpressResponse) => {
  req.body.status = 'SUBMITTED';
  return updateOrderStatus(req, res);
};

export const cancelOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.sale.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Order not found', undefined, 404);
  }

  if (['COMPLETED', 'CANCELLED'].includes(existing.status)) {
    return sendError(res, `Cannot cancel ${existing.status.toLowerCase()} order`);
  }

  const { cancelReason } = req.body;

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.sale.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: cancelReason || null,
        cancelledBy: userId,
        updatedAt: new Date(),
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: { include: { modifiers: true } },
      },
    });

    if (existing.tableId) {
      const table = await tx.table.findUnique({ where: { id: existing.tableId } });
      if (table && table.status === 'OCCUPIED') {
        await tx.table.update({
          where: { id: existing.tableId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    await tx.saleStatusHistory.create({
      data: {
        saleId: id,
        status: 'CANCELLED',
        notes: cancelReason || 'Order cancelled',
        changedBy: userId,
      },
    });

    return updated;
  });

  await createAuditLog(restaurantId, userId, 'CANCEL', 'Order', id, `Cancelled order ${order.orderNumber}. Reason: ${cancelReason || 'No reason provided'}`);
  return sendResponse(res, true, 'Order cancelled successfully', order);
};

export const getPosMenu = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId;

  if (!branchId) {
    return sendError(res, 'User must be assigned to a branch');
  }

  const categories = await prisma.menuCategory.findMany({
    where: { restaurantId, status: 'ACTIVE' },
    orderBy: { displayOrder: 'asc' },
    include: {
      menuItems: {
        where: {
          restaurantId,
          status: 'ACTIVE',
          available: true,
          branchAvailabilities: {
            some: { branchId, available: true },
          },
        },
        include: {
          modifierGroups: {
            include: {
              modifierGroup: {
                include: {
                  options: {
                    where: { status: 'ACTIVE' },
                    orderBy: { displayOrder: 'asc' },
                  },
                },
              },
            },
          },
        },
        orderBy: { displayOrder: 'asc' },
      },
    },
  });

  return sendResponse(res, true, 'POS menu retrieved', {
    categories: categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      items: cat.menuItems.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        sellingPrice: item.sellingPrice,
        taxRate: item.taxRate,
        image: item.image,
        modifierGroups: item.modifierGroups.map((mg) => ({
          id: mg.modifierGroup.id,
          name: mg.modifierGroup.name,
          selectionType: mg.modifierGroup.selectionType,
          isRequired: mg.modifierGroup.isRequired,
          options: mg.modifierGroup.options.map((opt) => ({
            id: opt.id,
            name: opt.name,
            priceAdjustment: opt.priceAdjustment,
          })),
        })),
      })),
    })),
  });
};

export const getPosTables = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId;

  if (!branchId) {
    return sendError(res, 'User must be assigned to a branch');
  }

  const tables = await prisma.table.findMany({
    where: {
      restaurantId,
      branchId,
      status: { not: 'INACTIVE' },
    },
    orderBy: { tableNumber: 'asc' },
    select: {
      id: true,
      tableNumber: true,
      name: true,
      capacity: true,
      status: true,
      section: { select: { id: true, name: true } },
    },
  });

  return sendResponse(res, true, 'POS tables retrieved', {
    tables: tables.map((t) => ({
      id: t.id,
      tableNumber: t.tableNumber,
      name: t.name,
      capacity: t.capacity,
      status: t.status,
      sectionName: t.section?.name,
      selectable: ['AVAILABLE', 'OCCUPIED', 'RESERVED'].includes(t.status),
    })),
  });
};
