import prisma from '../config/database';
import { notifyRestaurantStaff } from './notificationService';
import { manualDiscountError } from '../utils/discountPolicy';
import { cancelOrderSafely, NOT_FIRED_STATUSES, OrderCancelError } from './orderCancellationService';
import { Approver, sendApprovalError, verifyApproval } from './approvalService';
import { blockingPaymentsForCancel, lockSale } from './saleLedgerService';
import { isUniqueViolationOn, normalizeClientRequestId } from '../utils/idempotency';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';
import { calculateOrderTotals, OrderCalculationInput, taxFields } from './orderCalculationService';
import { createKitchenTicketForOrder } from './kitchenService';
import { completeOrder } from './orderCompletionService';
import { validatePromotion } from './promotionService';
import { deductInventoryForOrderSafely } from './inventoryService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';

/** Validates who served the order: an active staff member of this restaurant. */
async function resolveServedBy(restaurantId: string, value: unknown): Promise<string | null | 'INVALID'> {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return 'INVALID';
  const user = await prisma.user.findFirst({ where: { id: value, restaurantId, status: 'ACTIVE' }, select: { id: true } });
  return user ? user.id : 'INVALID';
}

/**
 * A discount above the person's own limit needs a manager whose limit covers
 * it. Returns the approver, null when no approval was needed, or false when a
 * response (approval needed / wrong PIN) has already been sent.
 */
async function approveDiscountIfNeeded(
  req: AuthRequest,
  res: ExpressResponse,
  discountError: string | null,
  discount: { type: 'FIXED' | 'PERCENTAGE'; value: number; subtotal: number },
  branchId: string
): Promise<Approver | null | false> {
  if (!discountError) return null;
  try {
    return await verifyApproval(req, 'give this discount', {
      branchId,
      allow: (approver) =>
        manualDiscountError(approver.roleName, approver.role, discount)
          ? `${approver.name}'s own limit doesn't cover this discount. Ask the owner.`
          : null,
    });
  } catch (err) {
    if (sendApprovalError(res, err)) return false;
    throw err;
  }
}

/**
 * Once the kitchen has an order, cancelling it needs a reason and a manager's
 * PIN. Orders that will be refused anyway (paid, M-Pesa in progress) skip the
 * PIN so nobody types it for nothing; the cancel itself re-checks everything.
 */
async function approveCancelIfNeeded(req: AuthRequest, res: ExpressResponse, orderId: string, reason: unknown): Promise<Approver | null | false> {
  const sale = await prisma.sale.findFirst({
    where: { id: orderId, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
    select: { status: true, branchId: true },
  });
  if (!sale || NOT_FIRED_STATUSES.includes(sale.status) || ['COMPLETED', 'CANCELLED'].includes(sale.status)) return null;
  const { paidAmount, mpesaInFlight } = await blockingPaymentsForCancel(prisma as any, orderId);
  if (paidAmount > 0.005 || mpesaInFlight) return null;
  if (typeof reason !== 'string' || !reason.trim()) {
    sendError(res, 'Give a reason for cancelling an order the kitchen already has.');
    return false;
  }
  try {
    return await verifyApproval(req, 'cancel an order the kitchen already has', { branchId: sale.branchId });
  } catch (err) {
    if (sendApprovalError(res, err)) return false;
    throw err;
  }
}

const sendCancelError = (res: ExpressResponse, error: OrderCancelError) =>
  error.code === 'APPROVAL_REQUIRED'
    ? sendError(res, error.message, { approval: ['APPROVAL_REQUIRED'] }, 428)
    : sendError(res, error.message, undefined, error.statusCode);

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
        branch: { select: { id: true, name: true, code: true, phone: true, address: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: {
          select: {
            id: true,
            itemNameSnapshot: true,
            unitPrice: true,
            quantity: true,
            notes: true,
            modifiers: true,
          },
        },
        payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
        onlineOrder: {
          select: {
            id: true,
            deliveryAddress: true,
            contactPhone: true,
            contactEmail: true,
            fulfillmentType: true,
            paymentMethod: true,
            trackingToken: true,
          },
        },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  const servedIds = [...new Set(orders.map((o) => o.servedBy).filter((v): v is string => !!v))];
  const servers = servedIds.length
    ? await prisma.user.findMany({ where: { id: { in: servedIds }, restaurantId }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const serverName = new Map(servers.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

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
        servedBy: o.servedBy,
        servedByName: o.servedBy ? serverName.get(o.servedBy) || null : null,
        completedAt: o.completedAt,
        cancelledAt: o.cancelledAt,
        cancelReason: o.cancelReason,
        branchId: o.branchId,
        branch: o.branch,
        branchName: o.branch.name,
        branchCode: o.branch.code,
        items: o.items || [],
        onlineOrder: o.onlineOrder || null,
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

  const server = order.servedBy
    ? await prisma.user.findFirst({ where: { id: order.servedBy, restaurantId }, select: { firstName: true, lastName: true } })
    : null;

  return sendResponse(res, true, 'Order retrieved', {
    ...order,
    servedByName: server ? `${server.firstName} ${server.lastName}`.trim() : null,
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

  // Retries of the same checkout (e.g. after a network timeout) return the
  // order that was already created instead of creating a duplicate.
  const clientRequestId = normalizeClientRequestId(req.body.clientRequestId);
  const findExistingByRequestId = () => clientRequestId
    ? prisma.sale.findUnique({
        where: { restaurantId_clientRequestId: { restaurantId, clientRequestId } },
        include: {
        branch: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: { include: { modifiers: true } },
      },
      })
    : Promise.resolve(null);
  const alreadyCreated = await findExistingByRequestId();
  if (alreadyCreated) {
    // A retry is also the chance to repair a ticket that failed to create the first time.
    if (['SUBMITTED', 'PREPARING', 'READY'].includes(alreadyCreated.status)) {
      await createKitchenTicketForOrder(alreadyCreated.id, restaurantId, alreadyCreated.branchId).catch((err: unknown) => console.error('Kitchen ticket repair failed:', err));
    }
    return sendResponse(res, true, 'Order already created', alreadyCreated, 200);
  }

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
    try {
      promotion = await validatePromotion(promotionId, restaurantId, branchId, customerId, baseSubtotal);
    } catch (promoErr: any) {
      return sendError(res, promoErr.message || 'Invalid promotion', undefined, 400);
    }
  }
  const role = await prisma.role.findUnique({ where: { id: req.user!.roleId }, select: { maxDiscountPercent: true, maxDiscountAmount: true } });
  let discountApprover: Approver | null = null;
  if (!promotion && Number(discountAmount || 0) !== 0) {
    const discount = {
      type: (req.body.discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED') as 'FIXED' | 'PERCENTAGE',
      value: Number(discountAmount),
      subtotal: baseSubtotal,
    };
    const discountError = manualDiscountError(req.user!.roleName, role, discount);
    const invalid = !Number.isFinite(discount.value) || discount.value < 0 || (discount.type === 'PERCENTAGE' && discount.value > 100);
    if (discountError && invalid) return sendError(res, discountError);
    const approved = await approveDiscountIfNeeded(req, res, discountError, discount, branchId);
    if (approved === false) return;
    discountApprover = approved;
  }
  // Waiters serve their own orders; a cashier ringing up for a waiter picks them.
  const servedByInput = req.body.servedBy !== undefined ? await resolveServedBy(restaurantId, req.body.servedBy) : req.user!.roleName === 'WAITER' ? userId : null;
  if (servedByInput === 'INVALID') return sendError(res, 'Choose a staff member from this restaurant as the server');
  const calculationInput: OrderCalculationInput = {
    items: normalizedItems,
    discountAmount: Math.max(0, Number(discountAmount) || 0),
    discountType: req.body.discountType || 'FIXED',
    restaurantId,
    branchId,
    promotion: promotion ? { discountType: promotion.discountType, value: promotion.value, scope: promotion.scope, menuItemId: promotion.menuItemId, maxDiscountAmount: promotion.maxDiscountAmount } : undefined,
  };

  const totals = await calculateOrderTotals(calculationInput);

  let order: any;
  try {
  order = await prisma.$transaction(async (tx) => {
    const counter = await tx.orderCounter.upsert({
      where: { restaurantId_branchId: { restaurantId, branchId } },
      create: { restaurantId, branchId, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    const orderNumber = `#${counter.lastNumber}`;

    const newOrder = await tx.sale.create({
      data: {
        orderNumber,
        clientRequestId,
        orderType: orderType || 'DINE_IN',
        customerName: customerName ? String(customerName).trim() : null,
        ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
        status: finalStatus,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        discountReason: discountReason ? String(discountReason).trim() : null,
        discountAppliedBy: (totals.discountAmount > 0 ? userId : null) as any,
        discountApprovedBy: totals.discountAmount > 0 && discountApprover ? discountApprover.id : null,
        servedBy: servedByInput,
        ...(promotionId
          ? { promotion: { connect: { id: promotionId } } }
          : {}),
        taxAmount: totals.taxAmount,
        ...taxFields(totals),
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
  } catch (err: any) {
    // Two identical requests raced; the other one created the order.
    if (isUniqueViolationOn(err, 'clientRequestId')) {
      const existing = await findExistingByRequestId();
      if (existing) return sendResponse(res, true, 'Order already created', existing, 200);
    }
    throw err;
  }

  if (['SUBMITTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'].includes(finalStatus) && order.tableId) {
    await prisma.table.update({
      where: { id: order.tableId },
      data: { status: 'OCCUPIED' },
    });
  }

  if (finalStatus === 'SUBMITTED') {
    try {
      await createKitchenTicketForOrder(order.id, restaurantId, branchId);
    } catch (err) {
      // The order is saved; failing the request here would make the till retry it.
      // Tell staff so the kitchen isn't left unaware (a payment or retry re-creates it).
      console.error('Kitchen ticket creation failed for new order:', err);
      void notifyRestaurantStaff(restaurantId, branchId, 'KITCHEN_ALERT', 'Order not on kitchen screen',
        `Order ${order.orderNumber} was saved but did not reach the kitchen display. Tell the kitchen, or reopen it from Orders.`, 'SALE', order.id)
        .catch(() => undefined);
    }
  }

  if (finalStatus === 'COMPLETED') {
    await deductInventoryForOrderSafely(order.id, restaurantId, branchId);
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

  // Items and pricing can only change before the order goes to the kitchen and
  // before any money is taken. Afterwards the kitchen ticket and the payments
  // would no longer match the bill: cancel and re-ring, or add a new order.
  const changesPricing = (Array.isArray(items) && items.length > 0) || discountAmount !== undefined || req.body.discountType !== undefined || promotionId !== undefined;
  if (changesPricing) {
    if (!['DRAFT', 'HELD'].includes(existing.status)) {
      return sendError(res, `Items and discounts can't be changed once an order is ${existing.status.toLowerCase()}. Add a new order for extra items, or cancel and re-enter it.`, undefined, 409);
    }
    const paidCount = await prisma.payment.count({ where: { saleId: id, status: 'COMPLETED' } });
    if (paidCount > 0) {
      return sendError(res, "Items and discounts can't be changed after a payment has been taken. Refund it first.", undefined, 409);
    }
  }

  let updateData: any = {};
  if (notes !== undefined) updateData.notes = notes ? String(notes).trim() : null;
  if (tableId !== undefined) {
    if (tableId) {
      const table = await prisma.table.findFirst({
        where: { id: tableId, branchId: existing.branchId, restaurantId, status: { not: 'INACTIVE' } },
      });
      if (!table) return sendError(res, 'Invalid table for this branch');
      if (['SUBMITTED', 'PREPARING', 'READY', 'SERVED'].includes(existing.status) && table.status === 'OUT_OF_SERVICE') {
        return sendError(res, 'Cannot assign order to an out-of-service table');
      }
    }
    updateData.tableId = tableId || null;
  }
  if (orderType !== undefined) updateData.orderType = orderType;
  if (req.body.servedBy !== undefined) {
    const servedBy = await resolveServedBy(restaurantId, req.body.servedBy);
    if (servedBy === 'INVALID') return sendError(res, 'Choose a staff member from this restaurant as the server');
    updateData.servedBy = servedBy;
  }

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
      try {
        promotion = await validatePromotion(effectivePromotionId, restaurantId, existing.branchId, effectiveCustomerId, baseSubtotal);
      } catch (promoErr: any) {
        return sendError(res, promoErr.message || 'Invalid promotion', undefined, 400);
      }
    }
    const role = await prisma.role.findUnique({ where: { id: req.user!.roleId }, select: { maxDiscountPercent: true, maxDiscountAmount: true } });
    const requestedDiscount = discountAmount !== undefined ? Number(discountAmount || 0) : Number(existing.discountAmount || 0);
    // Only a discount the editor sets now needs their approval. A discount
    // already on the order (e.g. approved by a manager) is inherited, as long
    // as this edit doesn't make it bigger in KES.
    const discountChanged = discountAmount !== undefined || req.body.discountType !== undefined;
    let updateApprover: Approver | null = null;
    // Any pricing change re-checks the discount against the NEW bill: keeping a
    // KES 1,000 discount while swapping the items down to KES 1,000 is a 100%
    // discount and needs approval like any other.
    if (!promotion && requestedDiscount !== 0) {
      const type: 'FIXED' | 'PERCENTAGE' = discountChanged && req.body.discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED';
      const invalid = !Number.isFinite(requestedDiscount) || requestedDiscount < 0 || (type === 'PERCENTAGE' && requestedDiscount > 100);
      const discountError = manualDiscountError(req.user!.roleName, role, { type, value: requestedDiscount, subtotal: baseSubtotal });
      if (discountError && invalid) return sendError(res, discountError);
      if (discountError) {
        const approved = await approveDiscountIfNeeded(req, res, discountError, { type, value: requestedDiscount, subtotal: baseSubtotal }, existing.branchId);
        if (approved === false) return;
        updateApprover = approved;
      }
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
      // Keep the VAT mode the bill was created with, even if the setting changed since.
      pricesIncludeTax: existing.taxInclusive,
      restaurantId,
      branchId: existing.branchId,
      promotion: promotion ? { discountType: promotion.discountType, value: promotion.value, scope: promotion.scope, menuItemId: promotion.menuItemId, maxDiscountAmount: promotion.maxDiscountAmount } : undefined,
    };

    const totals = await calculateOrderTotals(calculationInput);
    updateData.subtotal = totals.subtotal;
    updateData.discountAmount = totals.discountAmount;
    updateData.discountReason = discountReason !== undefined ? (discountReason ? String(discountReason).trim() : null) : existing.discountReason;
    updateData.discountAppliedBy = totals.discountAmount > 0 ? userId : null;
    // Keep an earlier manager approval only while the discount stays within it.
    // Recorded only when this edit needed (and got) a manager's approval.
    updateData.discountApprovedBy = totals.discountAmount > 0 && updateApprover ? updateApprover.id : null;
    updateData.taxAmount = totals.taxAmount;
    Object.assign(updateData, taxFields(totals));
    updateData.serviceChargeAmount = totals.serviceChargeAmount;
    updateData.totalAmount = totals.totalAmount;

    let order: any;
    try {
    order = await prisma.$transaction(async (tx) => {
      // Re-check under the order lock: it may have been submitted or paid since it was read.
      await lockSale(tx, id);
      const current = await tx.sale.findUnique({ where: { id }, select: { status: true } });
      if (!current || !['DRAFT', 'HELD'].includes(current.status)) throw new Error('ORDER_NOT_EDITABLE');
      if (await tx.payment.count({ where: { saleId: id, status: 'COMPLETED' } })) throw new Error('ORDER_NOT_EDITABLE');
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

    } catch (err: any) {
      if (err?.message === 'ORDER_NOT_EDITABLE') return sendError(res, 'This order was just sent to the kitchen or paid, so its items can no longer be changed.', undefined, 409);
      throw err;
    }

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

  if (status === 'CANCELLED') {
    const approver = await approveCancelIfNeeded(req, res, id, req.body.cancelReason || notes);
    if (approver === false) return;
    try {
      const order = await cancelOrderSafely({ orderId: id, restaurantId, branchId: req.user!.branchId, userId, reason: req.body.cancelReason || notes, approvedBy: approver?.id });
      await createAuditLog(restaurantId, userId, 'CANCEL', 'Order', id, `Cancelled order ${order.orderNumber}${approver ? `, approved by ${approver.name}` : ''}. Reason: ${req.body.cancelReason || notes || 'No reason provided'}`);
      return sendResponse(res, true, 'Order status updated', order);
    } catch (error: any) {
      if (error instanceof OrderCancelError) return sendCancelError(res, error);
      throw error;
    }
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

  let order: any;
  try {
    order = await prisma.$transaction(async (tx) => {
    // Re-check under the order lock: the status may have changed since it was read
    // (e.g. cancelled or paid-and-completed by someone else a moment ago).
    await lockSale(tx, id);
    const current = await tx.sale.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new Error('ORDER_NOT_FOUND');
    if (current.status !== existing.status) throw new Error(`STATUS_CHANGED:${current.status}`);

    const updateData: any = { status, updatedAt: new Date() };

    if (status === 'SUBMITTED' && existing.tableId) {
      await tx.table.update({
        where: { id: existing.tableId },
        data: { status: 'OCCUPIED' },
      });
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
  } catch (error: any) {
    if (error?.message === 'ORDER_NOT_FOUND') return sendError(res, 'Order not found', undefined, 404);
    if (typeof error?.message === 'string' && error.message.startsWith('STATUS_CHANGED:')) {
      return sendError(res, `This order was just changed to ${error.message.split(':')[1]}. Refresh and try again.`, undefined, 409);
    }
    throw error;
  }

  if (status === 'SUBMITTED' && existing.branchId) {
    try {
      await createKitchenTicketForOrder(order.id, restaurantId, existing.branchId);
    } catch (ticketErr) {
      console.error('Kitchen ticket creation error:', ticketErr);
    }
  }

  // Food has left the kitchen: deduct stock now. A served order that is already
  // fully paid has nothing left to do, so close it.
  if (status === 'SERVED' || status === 'OUT_FOR_DELIVERY') {
    if (status === 'SERVED' && order.paymentStatus === 'PAID') {
      try { await completeOrder(order.id, restaurantId, userId); } catch (err) { console.error('Auto-complete of paid served order failed:', err); }
    } else {
      await deductInventoryForOrderSafely(order.id, restaurantId, existing.branchId);
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
  const { cancelReason } = req.body || {};
  const approver = await approveCancelIfNeeded(req, res, id, cancelReason);
  if (approver === false) return;
  try {
    const order = await cancelOrderSafely({ orderId: id, restaurantId, branchId: req.user!.branchId, userId, reason: cancelReason, approvedBy: approver?.id });
    await createAuditLog(restaurantId, userId, 'CANCEL', 'Order', id, `Cancelled order ${order.orderNumber}${approver ? `, approved by ${approver.name}` : ''}. Reason: ${cancelReason || 'No reason provided'}`);
    return sendResponse(res, true, 'Order cancelled successfully', order);
  } catch (error: any) {
    if (error instanceof OrderCancelError) return sendCancelError(res, error);
    throw error;
  }
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
        taxCategory: item.taxCategory,
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

export const syncOfflineOrders = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;
  const userBranchId = req.user!.branchId;

  const orders = req.body.orders;
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return sendError(res, 'No offline orders provided to sync', undefined, 400);
  }

  if (orders.length > 100) {
    return sendError(res, 'Sync at most 100 offline orders per request', undefined, 400);
  }

  const syncedOrders: Array<{ offlineId: string; serverOrderId: string; serverOrderNumber: string }> = [];
  const errors: Array<{ offlineId: string; error: string }> = [];

  // Offline orders are re-priced on the server. Prices, totals and discounts
  // sent by the device are never trusted, exactly like createOrder.
  const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.roleName);
  const role = await prisma.role.findUnique({
    where: { id: req.user!.roleId },
    select: { maxDiscountPercent: true, maxDiscountAmount: true },
  });

  for (const offlineOrder of orders) {
    const offlineId = String(offlineOrder?.id || '');
    if (!offlineId) continue;

    // Branch: staff locked to a branch may only sync into it; owners/admins/
    // managers may sync into any branch of their own restaurant.
    const requestedBranchId = offlineOrder.branchId ? String(offlineOrder.branchId) : userBranchId;
    let branchId: string | undefined;
    if (requestedBranchId && requestedBranchId === userBranchId) {
      branchId = userBranchId;
    } else if (requestedBranchId && canSwitchBranch) {
      const branch = await prisma.branch.findFirst({ where: { id: requestedBranchId, restaurantId }, select: { id: true } });
      branchId = branch?.id;
    }
    if (!branchId) {
      errors.push({ offlineId, error: 'This order belongs to a branch your account cannot access' });
      continue;
    }

    try {
      // 1. Idempotency: the offline id is the order's clientRequestId (unique per
      // restaurant). Orders synced before that existed are found by their notes tag.
      const offlineTag = `[OfflineID: ${offlineId}]`;
      const offlineRequestId = normalizeClientRequestId(offlineId);
      const existing =
        (offlineRequestId
          ? await prisma.sale.findUnique({
              where: { restaurantId_clientRequestId: { restaurantId, clientRequestId: offlineRequestId } },
              select: { id: true, orderNumber: true },
            })
          : null) ||
        (await prisma.sale.findFirst({
          where: { restaurantId, notes: { contains: offlineTag } },
          select: { id: true, orderNumber: true },
        }));

      if (existing) {
        syncedOrders.push({
          offlineId,
          serverOrderId: existing.id,
          serverOrderNumber: existing.orderNumber,
        });
        continue;
      }

      // 2. Validate items
      const rawItems: any[] = Array.isArray(offlineOrder.items) ? offlineOrder.items : [];
      if (rawItems.length === 0) {
        errors.push({ offlineId, error: 'Order has no items' });
        continue;
      }
      if (rawItems.some((item) => {
        const qty = Number(item?.quantity);
        return !Number.isInteger(qty) || qty < 1 || qty > 500;
      })) {
        errors.push({ offlineId, error: 'Item quantity must be a whole number between 1 and 500' });
        continue;
      }

      // Look up authoritative prices. Inactive items are still accepted (the
      // sale already happened offline) but must belong to this restaurant.
      const menuItemIds = [...new Set(rawItems.map((item) => String(item?.menuItemId || '')))];
      const dbMenuItems = await prisma.menuItem.findMany({
        where: { id: { in: menuItemIds }, restaurantId },
        select: { id: true, name: true, sellingPrice: true },
      });
      if (dbMenuItems.length !== menuItemIds.length) {
        errors.push({ offlineId, error: 'Order contains menu items that do not exist in this restaurant' });
        continue;
      }
      const menuMap = new Map(dbMenuItems.map((mi) => [mi.id, mi]));

      const modifierIds = [...new Set(rawItems.flatMap((item) =>
        (Array.isArray(item?.modifiers) ? item.modifiers : []).map((m: any) => String(m?.modifierOptionId || ''))))];
      const dbModifiers = modifierIds.length
        ? await prisma.modifierOption.findMany({
            where: { id: { in: modifierIds }, modifierGroup: { restaurantId } },
            select: { id: true, name: true, priceAdjustment: true },
          })
        : [];
      if (dbModifiers.length !== modifierIds.length) {
        errors.push({ offlineId, error: 'Order contains invalid modifier options' });
        continue;
      }
      const modifierMap = new Map(dbModifiers.map((m) => [m.id, m]));

      const normalizedItems = rawItems.map((item) => {
        const menu = menuMap.get(String(item.menuItemId))!;
        const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map((m: any) => {
          const mod = modifierMap.get(String(m.modifierOptionId))!;
          return { modifierOptionId: mod.id, optionNameSnapshot: mod.name, priceAdjustment: mod.priceAdjustment };
        });
        return {
          menuItemId: menu.id,
          itemNameSnapshot: menu.name,
          unitPrice: menu.sellingPrice,
          quantity: Number(item.quantity),
          notes: item.notes ? String(item.notes).trim() : null,
          modifiers,
        };
      });

      // Manual discounts are subject to the same role approval limits as online orders.
      const discountType: 'FIXED' | 'PERCENTAGE' = offlineOrder.discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED';
      const requestedDiscount = Number(offlineOrder.discountAmount || 0);
      if (!Number.isFinite(requestedDiscount) || requestedDiscount < 0) {
        errors.push({ offlineId, error: 'Invalid discount amount' });
        continue;
      }
      let customerId: string | undefined;
      if (offlineOrder.customerId) {
        const customer = await prisma.customer.findFirst({ where: { id: String(offlineOrder.customerId), restaurantId }, select: { id: true } });
        customerId = customer?.id;
      }

      // A promotion is re-validated on the server, as of when the order was
      // taken (a happy-hour order may sync hours later); it replaces any manual discount.
      const takenAtRaw = offlineOrder.createdAt ? new Date(offlineOrder.createdAt) : null;
      const takenAt = takenAtRaw && !Number.isNaN(takenAtRaw.getTime()) && takenAtRaw.getTime() <= Date.now() ? takenAtRaw : new Date();
      let offlinePromotion: any = undefined;
      if (offlineOrder.promotionId) {
        const offlineSubtotal = normalizedItems.reduce(
          (sum: number, item: any) => sum + (item.unitPrice + item.modifiers.reduce((m: number, mod: any) => m + (mod.priceAdjustment || 0), 0)) * item.quantity,
          0,
        );
        try {
          offlinePromotion = await validatePromotion(String(offlineOrder.promotionId), restaurantId, branchId, customerId, offlineSubtotal, takenAt);
        } catch (promoErr: any) {
          errors.push({ offlineId, error: `Promotion no longer valid: ${promoErr?.message || 'invalid promotion'}` });
          continue;
        }
      }

      const totals = await calculateOrderTotals({
        items: normalizedItems,
        discountAmount: offlinePromotion ? 0 : requestedDiscount,
        discountType,
        restaurantId,
        branchId,
        promotion: offlinePromotion ? { discountType: offlinePromotion.discountType, value: offlinePromotion.value, scope: offlinePromotion.scope, menuItemId: offlinePromotion.menuItemId, maxDiscountAmount: offlinePromotion.maxDiscountAmount } : undefined,
      });

      if (!offlinePromotion && requestedDiscount > 0) {
        const discountError = manualDiscountError(req.user!.roleName, role, {
          type: discountType,
          value: requestedDiscount,
          subtotal: totals.subtotal,
        });
        if (discountError) {
          errors.push({ offlineId, error: 'Discount exceeds your approval limit. A manager must re-enter this order.' });
          continue;
        }
      }


      const parsedCreatedAt = offlineOrder.createdAt ? new Date(offlineOrder.createdAt) : null;
      const createdAt = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime()) && parsedCreatedAt.getTime() <= Date.now()
        ? parsedCreatedAt
        : new Date();

      const clientTotal = Number(offlineOrder.totalAmount);
      const priceNote = Number.isFinite(clientTotal) && Math.abs(clientTotal - totals.totalAmount) > 0.01
        ? ` [Offline total ${clientTotal} re-priced to ${totals.totalAmount}]`
        : '';

      // 3. Process inside transaction
      const createdSale = await prisma.$transaction(async (tx) => {
        // Atomic sequential order number
        const counter = await tx.orderCounter.upsert({
          where: { restaurantId_branchId: { restaurantId, branchId } },
          create: { restaurantId, branchId, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });

        const orderNumber = `#${counter.lastNumber}`;

        // Validate table if provided
        let tableConnect: any = undefined;
        if (offlineOrder.tableId) {
          const tbl = await tx.table.findFirst({
            where: { id: offlineOrder.tableId, branchId, restaurantId, status: { not: 'INACTIVE' } },
            select: { id: true },
          });
          if (tbl) {
            tableConnect = { connect: { id: tbl.id } };
          }
        }

        const notesWithTag = `${offlineOrder.notes ? String(offlineOrder.notes).trim() + ' ' : ''}${offlineTag} [OfflineRef: ${offlineOrder.offlineOrderNumber || 'OFF'}] [OfflineCreated: ${createdAt.toISOString()}]${priceNote}`;

        const finalStatus = offlineOrder.status === 'HELD' ? 'HELD' : 'SUBMITTED';
        const orderType = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(offlineOrder.orderType) ? offlineOrder.orderType : 'DINE_IN';

        const newSale = await tx.sale.create({
          data: {
            orderNumber,
            clientRequestId: offlineRequestId,
            orderType,
            customerName: offlineOrder.customerName ? String(offlineOrder.customerName).trim() : null,
            ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
            status: finalStatus,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            discountReason: totals.discountAmount > 0 ? (offlinePromotion ? `Promotion: ${offlinePromotion.name}` : (offlineOrder.discountReason ? String(offlineOrder.discountReason).trim() : 'Offline Discount')) : null,
            ...(offlinePromotion ? { promotion: { connect: { id: offlinePromotion.id } } } : {}),
            discountAppliedBy: totals.discountAmount > 0 ? userId : null,
            taxAmount: totals.taxAmount,
            ...taxFields(totals),
            serviceChargeAmount: totals.serviceChargeAmount,
            totalAmount: totals.totalAmount,
            notes: notesWithTag,
            createdBy: userId,
            createdAt,
            restaurant: { connect: { id: restaurantId } },
            branch: { connect: { id: branchId } },
            ...(tableConnect ? { table: tableConnect } : {}),
            items: {
              create: normalizedItems.map((item) => ({
                menuItemId: item.menuItemId,
                itemNameSnapshot: item.itemNameSnapshot,
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                subtotal: Math.round((item.unitPrice * item.quantity + item.modifiers.reduce((sum: number, m: { priceAdjustment: number }) => sum + m.priceAdjustment * item.quantity, 0)) * 100) / 100,
                notes: item.notes,
                modifiers: { create: item.modifiers },
              })),
            },
          },
          include: {
            items: { include: { modifiers: true } },
          },
        });

        await tx.saleStatusHistory.create({
          data: {
            saleId: newSale.id,
            status: finalStatus,
            changedBy: userId,
            notes: `Synced from offline queue (${offlineOrder.offlineOrderNumber || 'OFF'})`,
          },
        });

        if (finalStatus === 'SUBMITTED' && offlineOrder.tableId) {
          await tx.table.updateMany({
            where: { id: offlineOrder.tableId, branchId },
            data: { status: 'OCCUPIED' },
          });
        }

        return newSale;
      });

      if (createdSale.status === 'SUBMITTED') {
        try {
          await createKitchenTicketForOrder(createdSale.id, restaurantId, branchId);
        } catch (e) {
          console.warn('[OfflineSync] Note: kitchen ticket routing completed with notice:', e);
        }
      }

      syncedOrders.push({
        offlineId,
        serverOrderId: createdSale.id,
        serverOrderNumber: createdSale.orderNumber,
      });
    } catch (orderErr: any) {
      // Another sync of the same offline order won the race: report it as synced.
      if (isUniqueViolationOn(orderErr, 'clientRequestId')) {
        const winner = await prisma.sale.findFirst({ where: { restaurantId, clientRequestId: normalizeClientRequestId(offlineId) }, select: { id: true, orderNumber: true } });
        if (winner) {
          syncedOrders.push({ offlineId, serverOrderId: winner.id, serverOrderNumber: winner.orderNumber });
          continue;
        }
      }
      console.error(`[OfflineSync] Error syncing offline order ${offlineId}:`, orderErr);
      errors.push({ offlineId, error: orderErr.message || 'Failed to sync order' });
    }
  }

  const message = syncedOrders.length === 0 && errors.length > 0
    ? errors[0].error
    : 'Offline orders synchronization processed';
  return sendResponse(res, true, message, {
    syncedCount: syncedOrders.length,
    failedCount: errors.length,
    syncedOrders,
    errors,
  });
};
