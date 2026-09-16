import crypto from 'crypto';
import prisma from '../config/database';
import { calculateOrderTotals, OrderCalculationInput } from './orderCalculationService';
import { validatePromotion } from './promotionService';
import { createKitchenTicketForOrder } from './kitchenService';
import { notifyRestaurantStaff } from './notificationService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate, notifyCustomerReservation } from './customerNotificationService';
import { sendError, sendResponse } from '../utils/response';
import { Request, Response } from 'express';

const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY'];
const FULFILLMENT_TYPES = ['PICKUP', 'DELIVERY'];

const token = () => crypto.randomBytes(18).toString('hex');

export const getPublicRestaurants = async (_req: Request, res: Response) => {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, name: true, description: true, phone: true, email: true, address: true, city: true, currency: true, logo: true,
      branches: { where: { status: 'ACTIVE' }, select: { id: true, name: true, code: true, address: true, city: true, phone: true, callPhone: true, diningHours: true } },
    },
    orderBy: { name: 'asc' },
  });
  return sendResponse(res, true, 'Public restaurants retrieved', { restaurants });
};

export const getPublicMenu = async (req: Request, res: Response) => {
  const restaurantId = String(req.query.restaurantId || '').trim();
  const branchId = String(req.query.branchId || '').trim();
  if (!restaurantId || !branchId) return sendError(res, 'restaurantId and branchId are required');

  const restaurant = await prisma.restaurant.findFirst({ where: { id: restaurantId, status: 'ACTIVE' }, select: { id: true, name: true, description: true, phone: true, address: true, city: true, currency: true, logo: true } });
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId, status: 'ACTIVE' }, select: { id: true, name: true, code: true, address: true, city: true, phone: true } });
  if (!restaurant || !branch) return sendError(res, 'Restaurant or branch not found', undefined, 404);

  const categories = await prisma.menuCategory.findMany({ where: { restaurantId, status: 'ACTIVE' }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
  const items = await prisma.menuItem.findMany({
    where: { restaurantId, status: 'ACTIVE', available: true, branchAvailabilities: { none: { branchId, available: false } } },
    include: { category: { select: { id: true, name: true } }, branchAvailabilities: { where: { branchId }, select: { available: true } } },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });

  return sendResponse(res, true, 'Public menu retrieved', {
    restaurant, branch, categories,
    items: items.map(({ branchAvailabilities, ...item }) => ({ ...item, branchAvailable: branchAvailabilities[0]?.available ?? true })),
  });
};

export const createPublicOrder = async (req: Request, res: Response) => {
  const body = req.body || {};
  const restaurantId = String(body.restaurantId || '').trim();
  const branchId = String(body.branchId || '').trim();
  const fulfillmentType = String(body.fulfillmentType || 'PICKUP').toUpperCase();
  const paymentMethod = String(body.paymentMethod || 'CASH').toUpperCase();
  const customerName = String(body.customerName || '').trim();
  const contactPhone = String(body.contactPhone || '').trim();
  const contactEmail = String(body.contactEmail || '').trim();
  const deliveryAddress = String(body.deliveryAddress || '').trim();
  const notes = String(body.notes || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!restaurantId || !branchId) return sendError(res, 'Restaurant and branch are required');
  if (!customerName) return sendError(res, 'Customer name is required');
  if (!contactPhone && !contactEmail) return sendError(res, 'A phone number or email is required');
  if (!FULFILLMENT_TYPES.includes(fulfillmentType)) return sendError(res, 'Invalid fulfillment type');
  if (fulfillmentType === 'DELIVERY' && !deliveryAddress) return sendError(res, 'Delivery address is required');
  if (!PAYMENT_METHODS.includes(paymentMethod)) return sendError(res, 'Invalid payment method');
  if (!items.length) return sendError(res, 'Your cart is empty');

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId, status: 'ACTIVE' } });
  if (!branch) return sendError(res, 'Selected branch is unavailable', undefined, 404);

  const normalized: Array<{ menuItemId: string; quantity: number }> = items.map((item: any) => ({ menuItemId: String(item.menuItemId || ''), quantity: Math.max(1, Math.min(50, Math.floor(Number(item.quantity || 1))) ) }));
  if (normalized.some((item: { menuItemId: string; quantity: number }) => !item.menuItemId)) return sendError(res, 'Invalid menu item');

  const menuItemIds: string[] = [...new Set(normalized.map((item: { menuItemId: string; quantity: number }) => item.menuItemId))];
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, restaurantId, status: 'ACTIVE', available: true, branchAvailabilities: { none: { branchId, available: false } } },
    select: { id: true, name: true, sellingPrice: true },
  });
  if (menuItems.length !== menuItemIds.length) return sendError(res, 'One or more menu items are no longer available');
  const menuMap = new Map(menuItems.map((item) => [item.id, item]));

  let customer = await prisma.customer.findFirst({ where: { restaurantId, OR: [ ...(contactPhone ? [{ phone: contactPhone }] : []), ...(contactEmail ? [{ email: contactEmail }] : []) ] } });
  if (!customer) {
    customer = await prisma.customer.create({ data: { restaurantId, name: customerName, phone: contactPhone || null, email: contactEmail || null, address: deliveryAddress || null, notes: 'Created from online ordering', status: 'ACTIVE' } });
  } else {
    customer = await prisma.customer.update({ where: { id: customer.id }, data: { name: customerName || customer.name, ...(contactPhone ? { phone: contactPhone } : {}), ...(contactEmail ? { email: contactEmail } : {}), ...(deliveryAddress ? { address: deliveryAddress } : {}) } });
  }

  let promotion: any = undefined;
  let promotionId: string | undefined;
  const promoCode = String(body.promoCode || '').trim();
  const baseSubtotal = normalized.reduce((sum: number, item: { menuItemId: string; quantity: number }) => sum + (menuMap.get(item.menuItemId)!.sellingPrice * item.quantity), 0);
  if (promoCode) {
    const found = await prisma.promotion.findFirst({ where: { restaurantId, active: true, code: { equals: promoCode } } });
    if (!found) return sendError(res, 'Promotion code is invalid');
    promotion = await validatePromotion(found.id, restaurantId, branchId, customer.id, baseSubtotal);
    promotionId = found.id;
  }

  const calcItems = normalized.map((item: { menuItemId: string; quantity: number }) => ({ menuItemId: item.menuItemId, unitPrice: menuMap.get(item.menuItemId)!.sellingPrice, quantity: item.quantity, modifiers: [] }));
  const totals = await calculateOrderTotals({ items: calcItems, discountAmount: 0, discountType: 'FIXED', restaurantId, branchId, promotion: promotion ? { discountType: promotion.discountType, value: promotion.value, scope: promotion.scope, menuItemId: promotion.menuItemId, maxDiscountAmount: promotion.maxDiscountAmount } : undefined } as OrderCalculationInput);

  const systemUser = await prisma.user.findFirst({ where: { restaurantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!systemUser) return sendError(res, 'Online ordering is not configured for this restaurant', undefined, 409);

  const trackingToken = token();
  const result = await prisma.$transaction(async (tx) => {
    const counter = await tx.orderCounter.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } });
    const next = (counter?.lastNumber || 0) + 1;
    if (counter) await tx.orderCounter.update({ where: { restaurantId_branchId: { restaurantId, branchId } }, data: { lastNumber: next } });
    else await tx.orderCounter.create({ data: { restaurantId, branchId, lastNumber: next } });

    const order = await tx.sale.create({
      data: {
        restaurantId, branchId, orderNumber: `#${next}`, orderType: fulfillmentType === 'DELIVERY' ? 'DELIVERY' : 'PICKUP', customerId: customer!.id, customerName,
        status: 'SUBMITTED', paymentStatus: 'UNPAID', amountPaid: 0,
        subtotal: totals.subtotal, discountAmount: totals.discountAmount, discountReason: promotion ? `Promotion: ${promoCode}` : null,
        promotionId: promotionId || null, taxAmount: totals.taxAmount, serviceChargeAmount: totals.serviceChargeAmount, totalAmount: totals.totalAmount,
        notes: notes || null, createdBy: systemUser.id,
        items: { create: normalized.map((item: { menuItemId: string; quantity: number }) => { const menu = menuMap.get(item.menuItemId)!; return { menuItemId: menu.id, itemNameSnapshot: menu.name, unitPrice: menu.sellingPrice, quantity: item.quantity, subtotal: menu.sellingPrice * item.quantity }; }) },
      },
      include: { items: true },
    });
    await tx.saleStatusHistory.create({ data: { saleId: order.id, status: 'SUBMITTED', changedBy: systemUser.id, notes: 'Order placed via online ordering' } });
    await tx.onlineOrder.create({ data: { restaurantId, branchId, saleId: order.id, fulfillmentType, deliveryAddress: fulfillmentType === 'DELIVERY' ? deliveryAddress : null, contactPhone: contactPhone || null, contactEmail: contactEmail || null, paymentMethod, paymentState: paymentMethod === 'CASH' ? 'PAY_AT_PICKUP' : 'PENDING', trackingToken, customerNotes: notes || null } });
    if (paymentMethod !== 'CASH') await tx.payment.create({ data: { restaurantId, branchId, saleId: order.id, method: paymentMethod, amount: totals.totalAmount, status: 'PENDING', notes: 'Online payment pending provider confirmation', createdBy: systemUser.id } });
    return order;
  });

  await createKitchenTicketForOrder(result.id, restaurantId, branchId);
  // Notifications are best-effort and must never hold the customer's checkout response.
  void notifyRestaurantStaff(restaurantId, branchId, 'ONLINE_ORDER', 'New online order', `Order #${result.orderNumber} was placed online.`, 'SALE', result.id).catch((err) => console.error('Online order staff notification failed:', err));

  // Broadcast realtime events to branch and kitchen displays
  realtimeService.broadcast(`orders:${branchId}`, 'new_online_order', {
    orderId: result.id,
    orderNumber: result.orderNumber,
    customerName,
    fulfillmentType,
    totalAmount: result.totalAmount,
    placedAt: new Date().toISOString(),
  });

  realtimeService.broadcast(`kitchen:${branchId}`, 'ticket_created', {
    orderId: result.id,
    orderNumber: result.orderNumber,
    placedAt: new Date().toISOString(),
  });

  // Dispatch customer SMS / Email notification & tracking event
  const restaurantRecord = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } });
  void notifyCustomerOrderUpdate({
    trackingToken,
    orderNumber: result.orderNumber,
    status: 'SUBMITTED',
    customerPhone: contactPhone || null,
    customerEmail: contactEmail || null,
    restaurantName: restaurantRecord?.name || 'Melio',
    totalAmount: result.totalAmount,
  }).catch((err) => console.error('Online order customer notification failed:', err));

  return sendResponse(res, true, 'Online order placed successfully', { orderId: result.id, orderNumber: result.orderNumber, trackingToken, totalAmount: result.totalAmount, paymentState: paymentMethod === 'CASH' ? 'PAY_AT_PICKUP' : 'PENDING', trackingUrl: `/online-order/${trackingToken}` }, 201);
};

export const confirmPublicPayment = async (req: Request, res: Response) => {
  const trackingToken = String(req.params.trackingToken || '');
  const online = await prisma.onlineOrder.findUnique({ where: { trackingToken }, include: { sale: true } });
  if (!online) return sendError(res, 'Order not found', undefined, 404);
  if (online.paymentMethod === 'CASH') return sendError(res, 'This order is payable at pickup/delivery');
  if (online.paymentState === 'PAID') return sendResponse(res, true, 'Payment already confirmed', { paymentState: 'PAID' });

  const reference = String(req.body?.reference || '').trim() || `ONLINE-${online.trackingToken.slice(0, 8).toUpperCase()}`;
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { saleId: online.saleId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED', reference } });
    else await tx.payment.create({ data: { restaurantId: online.restaurantId, branchId: online.branchId, saleId: online.saleId, method: online.paymentMethod, amount: online.sale.totalAmount, status: 'COMPLETED', reference, createdBy: online.sale.createdBy } });
    await tx.sale.update({ where: { id: online.saleId }, data: { amountPaid: online.sale.totalAmount, paymentStatus: 'PAID' } });
    await tx.onlineOrder.update({ where: { id: online.id }, data: { paymentState: 'PAID' } });
  });
  return sendResponse(res, true, 'Payment confirmed', { paymentState: 'PAID' });
};

export const getPublicOrderTracking = async (req: Request, res: Response) => {
  const trackingToken = String(req.params.trackingToken || '');
  const online = await prisma.onlineOrder.findUnique({
    where: { trackingToken },
    include: { restaurant: { select: { name: true, phone: true } }, branch: { select: { name: true, address: true, phone: true } }, sale: { include: { items: true } } },
  });
  if (!online) return sendError(res, 'Order not found', undefined, 404);
  return sendResponse(res, true, 'Order tracking retrieved', {
    orderNumber: online.sale.orderNumber, status: online.sale.status, paymentStatus: online.sale.paymentStatus, paymentState: online.paymentState,
    fulfillmentType: online.fulfillmentType, totalAmount: online.sale.totalAmount, placedAt: online.placedAt,
    restaurant: online.restaurant, branch: online.branch,
    items: online.sale.items.map((item) => ({ name: item.itemNameSnapshot, quantity: item.quantity, subtotal: item.subtotal })),
  });
};

export const createPublicReservation = async (req: Request, res: Response) => {
  const body = req.body || {};
  const restaurantId = String(body.restaurantId || '').trim();
  const branchId = String(body.branchId || '').trim();
  const customerName = String(body.customerName || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const partySize = Math.max(1, Math.min(50, Math.floor(Number(body.partySize || 2))));
  const dateStr = String(body.date || '').trim();
  const timeStr = String(body.time || '19:00').trim();
  const seatingArea = String(body.seatingArea || 'MAIN_DINING').trim();
  const specialRequests = String(body.specialRequests || body.notes || '').trim();
  const durationMinutes = Number(body.durationMinutes || 90);

  if (!restaurantId || !branchId) return sendError(res, 'Restaurant and branch are required');
  if (!customerName) return sendError(res, 'Guest name is required');
  if (!phone && !email) return sendError(res, 'Phone number or email is required');
  if (!dateStr) return sendError(res, 'Reservation date is required');

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId, status: 'ACTIVE' } });
  if (!branch) return sendError(res, 'Selected branch is unavailable', undefined, 404);

  const startAt = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(startAt.getTime())) return sendError(res, 'Invalid reservation date or time format');
  const endAt = new Date(startAt.getTime() + durationMinutes * 60000);

  // Link or create customer
  let customer = await prisma.customer.findFirst({
    where: { restaurantId, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        restaurantId,
        name: customerName,
        phone: phone || null,
        email: email || null,
        notes: 'Created via Online Table Reservation',
        status: 'ACTIVE',
      },
    });
  }

  // System user for creator
  const systemUser = await prisma.user.findFirst({
    where: { restaurantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!systemUser) return sendError(res, 'Reservations are not configured for this restaurant', undefined, 409);

  // Check available tables for this branch
  const tables = await prisma.table.findMany({
    where: { branchId, restaurantId, status: { not: 'OUT_OF_SERVICE' }, capacity: { gte: partySize } },
    orderBy: { capacity: 'asc' },
  });

  // Check table conflicts to find an automatically assignable table
  let assignedTableId: string | null = null;
  for (const table of tables) {
    const conflict = await prisma.reservation.findFirst({
      where: {
        restaurantId,
        branchId,
        tableId: table.id,
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (!conflict) {
      assignedTableId = table.id;
      break;
    }
  }

  const notesText = [
    seatingArea ? `[Seating: ${seatingArea}]` : '',
    specialRequests ? specialRequests : '',
  ].filter(Boolean).join(' ');

  const reservation = await prisma.reservation.create({
    data: {
      restaurantId,
      branchId,
      customerId: customer.id,
      tableId: assignedTableId,
      customerName,
      phone: phone || null,
      email: email || null,
      partySize,
      startAt,
      endAt,
      status: 'PENDING',
      notes: notesText || null,
      source: 'WEBSITE',
      createdBy: systemUser.id,
    },
    include: {
      branch: { select: { id: true, name: true, city: true, phone: true } },
      table: { select: { id: true, tableNumber: true, name: true } },
    },
  });

  const reservationCode = `RES-${reservation.id.slice(-6).toUpperCase()}`;

  await notifyRestaurantStaff(
    restaurantId,
    branchId,
    'RESERVATION',
    'New online table reservation',
    `Online reservation for ${customerName} (${partySize} guests) on ${dateStr} at ${timeStr}.`,
    'RESERVATION',
    reservation.id
  );

  // Broadcast realtime event to staff
  realtimeService.broadcast(`reservations:${branchId}`, 'new_reservation', {
    reservationId: reservation.id,
    reservationCode,
    customerName,
    partySize,
    date: dateStr,
    time: timeStr,
    status: reservation.status,
    tableNumber: reservation.table?.tableNumber || null,
  });

  // Notify customer
  const restData = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } });
  await notifyCustomerReservation({
    reference: reservationCode,
    customerName,
    customerPhone: phone || null,
    customerEmail: email || null,
    restaurantName: restData?.name || 'Melio',
    branchName: reservation.branch.name,
    reservationDate: dateStr,
    reservationTime: timeStr,
    guestCount: partySize,
    status: 'REQUESTED',
  });

  return sendResponse(
    res,
    true,
    'Table reservation requested successfully',
    {
      reservationId: reservation.id,
      reservationCode,
      customerName,
      partySize,
      date: dateStr,
      time: timeStr,
      status: reservation.status,
      branch: reservation.branch,
      tableNumber: reservation.table?.tableNumber || null,
      notes: reservation.notes,
    },
    201
  );
};

export const getPublicReservationTracking = async (req: Request, res: Response) => {
  const codeOrId = String(req.params.codeOrId || '').trim();
  if (!codeOrId) return sendError(res, 'Reservation code or ID required');

  let reservation = null;
  if (codeOrId.startsWith('RES-')) {
    const partialId = codeOrId.replace('RES-', '').toLowerCase();
    const matches = await prisma.reservation.findMany({
      where: { id: { endsWith: partialId } },
      include: {
        restaurant: { select: { name: true, phone: true } },
        branch: { select: { name: true, address: true, phone: true, city: true } },
        table: { select: { tableNumber: true } },
      },
    });
    reservation = matches[0] || null;
  } else {
    reservation = await prisma.reservation.findUnique({
      where: { id: codeOrId },
      include: {
        restaurant: { select: { name: true, phone: true } },
        branch: { select: { name: true, address: true, phone: true, city: true } },
        table: { select: { tableNumber: true } },
      },
    });
  }

  if (!reservation) return sendError(res, 'Reservation not found', undefined, 404);

  return sendResponse(res, true, 'Reservation details retrieved', {
    reservationCode: `RES-${reservation.id.slice(-6).toUpperCase()}`,
    customerName: reservation.customerName,
    partySize: reservation.partySize,
    startAt: reservation.startAt,
    endAt: reservation.endAt,
    status: reservation.status,
    notes: reservation.notes,
    restaurant: reservation.restaurant,
    branch: reservation.branch,
    tableNumber: reservation.table?.tableNumber || null,
  });
};

export const getPublicReservationAvailability = async (req: Request, res: Response) => {
  const restaurantId = String(req.query.restaurantId || '').trim();
  const branchId = String(req.query.branchId || '').trim();
  const dateStr = String(req.query.date || '').trim();
  const partySize = Number(req.query.partySize || 2);

  if (!restaurantId || !branchId || !dateStr) {
    return sendError(res, 'restaurantId, branchId and date are required');
  }

  const tables = await prisma.table.findMany({
    where: { branchId, restaurantId, status: { not: 'OUT_OF_SERVICE' }, capacity: { gte: partySize } },
  });

  const slots = ['12:00', '12:30', '13:00', '13:30', '14:00', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
  const availability = await Promise.all(
    slots.map(async (slot) => {
      const slotStart = new Date(`${dateStr}T${slot}:00`);
      const slotEnd = new Date(slotStart.getTime() + 90 * 60000);

      const activeReservations = await prisma.reservation.count({
        where: {
          restaurantId,
          branchId,
          status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
          startAt: { lt: slotEnd },
          endAt: { gt: slotStart },
        },
      });

      const availableTablesCount = Math.max(0, tables.length - activeReservations);
      return {
        time: slot,
        available: availableTablesCount > 0,
        availableTablesCount,
      };
    })
  );

  return sendResponse(res, true, 'Availability retrieved', {
    date: dateStr,
    partySize,
    totalEligibleTables: tables.length,
    slots: availability,
  });
};

