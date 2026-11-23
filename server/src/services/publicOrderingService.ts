import crypto from 'crypto';
import prisma from '../config/database';
import { calculateOrderTotals, OrderCalculationInput } from './orderCalculationService';
import { validatePromotion } from './promotionService';
import { createKitchenTicketForOrder } from './kitchenService';
import { notifyRestaurantStaff } from './notificationService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate, notifyCustomerReservation } from './customerNotificationService';
import { isPaymentSimulationEnabled, settleOnlinePayment } from './onlinePaymentService';
import { sendError, sendResponse } from '../utils/response';
import { resolvePublicCustomer } from './customerAuthService';
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
  let restaurantId = String(req.query.restaurantId || '').trim();
  let branchId = String(req.query.branchId || '').trim();

  if (!restaurantId) {
    const defaultRest = await prisma.restaurant.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
    if (defaultRest) restaurantId = defaultRest.id;
  }
  if (!branchId && restaurantId) {
    const defaultBranch = await prisma.branch.findFirst({ where: { restaurantId, status: 'ACTIVE' }, select: { id: true } });
    if (defaultBranch) branchId = defaultBranch.id;
  }

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
  if (paymentMethod === 'CARD' && !isPaymentSimulationEnabled()) return sendError(res, 'Card payments are not available yet. Please choose M-Pesa or pay on pickup/delivery.');
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

  // Order contact details (name, phone, address) are stored on the order itself;
  // the customer record is only linked, never overwritten from a public form.
  const customer = await resolvePublicCustomer(req, restaurantId, { name: customerName, phone: contactPhone, email: contactEmail, address: deliveryAddress, notes: 'Created from online ordering' });

  let promotion: any = undefined;
  let promotionId: string | undefined;
  const promoCode = String(body.promoCode || '').trim();
  const baseSubtotal = normalized.reduce((sum: number, item: { menuItemId: string; quantity: number }) => sum + (menuMap.get(item.menuItemId)!.sellingPrice * item.quantity), 0);
  if (promoCode) {
    const found = await prisma.promotion.findFirst({ where: { restaurantId, active: true, code: { equals: promoCode } } });
    if (!found) return sendError(res, 'Promotion code is invalid', undefined, 400);
    try {
      promotion = await validatePromotion(found.id, restaurantId, branchId, customer.id, baseSubtotal);
      promotionId = found.id;
    } catch (promoErr: any) {
      return sendError(res, promoErr.message || 'Invalid promotion code', undefined, 400);
    }
  }

  const calcItems = normalized.map((item: { menuItemId: string; quantity: number }) => ({ menuItemId: item.menuItemId, unitPrice: menuMap.get(item.menuItemId)!.sellingPrice, quantity: item.quantity, modifiers: [] }));
  const totals = await calculateOrderTotals({ items: calcItems, discountAmount: 0, discountType: 'FIXED', restaurantId, branchId, promotion: promotion ? { discountType: promotion.discountType, value: promotion.value, scope: promotion.scope, menuItemId: promotion.menuItemId, maxDiscountAmount: promotion.maxDiscountAmount } : undefined } as OrderCalculationInput);

  const systemUser = await prisma.user.findFirst({ where: { restaurantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!systemUser) return sendError(res, 'Online ordering is not configured for this restaurant', undefined, 409);

  const trackingToken = token();
  const result = await prisma.$transaction(async (tx) => {
    const counter = await tx.orderCounter.upsert({
      where: { restaurantId_branchId: { restaurantId, branchId } },
      create: { restaurantId, branchId, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    const next = counter.lastNumber;

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

  // Pay-on-pickup/delivery orders go to the kitchen now. Prepaid (M-Pesa/card)
  // orders go to the kitchen once the payment is confirmed (settleOnlinePayment),
  // so unpaid or fake orders never reach the cooks.
  const sendToKitchenNow = paymentMethod === 'CASH';
  if (sendToKitchenNow) {
    try {
      await createKitchenTicketForOrder(result.id, restaurantId, branchId);
    } catch (err) {
      // The order is saved; failing here would make the customer retry and duplicate it.
      console.error('[Online order] Kitchen ticket creation failed; it is retried when staff record a payment:', err);
    }
  }
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

  if (sendToKitchenNow) {
    realtimeService.broadcast(`kitchen:${branchId}`, 'ticket_created', {
      orderId: result.id,
      orderNumber: result.orderNumber,
      placedAt: new Date().toISOString(),
    });
  }

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

  // Customers must never be able to mark their own order as paid. Real
  // payments are confirmed by the provider (see mpesaService callback).
  if (!isPaymentSimulationEnabled()) {
    return sendError(res, 'Payments are confirmed automatically by the payment provider.', undefined, 403);
  }

  const amount = Math.max(0, online.sale.totalAmount - online.sale.amountPaid);
  const reference = `SIM-ONLINE-${online.trackingToken.slice(0, 8).toUpperCase()}`;
  await settleOnlinePayment({
    onlineOrderId: online.id,
    method: online.paymentMethod,
    amount,
    reference,
    notes: 'SIMULATED online payment confirmation',
    displayMethod: online.paymentMethod,
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

  if (!customerName) return sendError(res, 'Guest name is required');
  if (!phone && !email) return sendError(res, 'Phone number or email is required');
  if (!dateStr) return sendError(res, 'Reservation date is required');

  let branch = null;
  if (branchId) {
    branch = await prisma.branch.findFirst({
      where: { id: branchId, ...(restaurantId ? { restaurantId } : {}), status: 'ACTIVE' },
      include: { restaurant: { select: { id: true, name: true, phone: true } } },
    });
  }
  if (!branch && restaurantId) {
    branch = await prisma.branch.findFirst({
      where: { restaurantId, status: 'ACTIVE' },
      include: { restaurant: { select: { id: true, name: true, phone: true } } },
    });
  }
  if (!branch) {
    branch = await prisma.branch.findFirst({
      where: { status: 'ACTIVE' },
      include: { restaurant: { select: { id: true, name: true, phone: true } } },
    });
  }
  if (!branch) return sendError(res, 'Selected branch is unavailable', undefined, 404);

  const effectiveRestaurantId = branch.restaurantId;
  const effectiveBranchId = branch.id;

  const startAt = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(startAt.getTime())) return sendError(res, 'Invalid reservation date or time format');
  const endAt = new Date(startAt.getTime() + durationMinutes * 60000);

  // Link to the signed-in customer, or to a guest profile (never a registered account).
  const customer = await resolvePublicCustomer(req, effectiveRestaurantId, { name: customerName, phone, email, notes: 'Created via Online Table Reservation' });

  // System user for creator
  let systemUser = await prisma.user.findFirst({
    where: { restaurantId: effectiveRestaurantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!systemUser) {
    systemUser = await prisma.user.findFirst({
      where: { restaurantId: effectiveRestaurantId },
      select: { id: true },
    });
  }
  if (!systemUser) {
    systemUser = await prisma.user.findFirst({
      select: { id: true },
    });
  }
  if (!systemUser) return sendError(res, 'Reservations are not configured for this restaurant', undefined, 409);

  // Check available tables for this branch
  const tables = await prisma.table.findMany({
    where: { branchId: effectiveBranchId, restaurantId: effectiveRestaurantId, status: { not: 'OUT_OF_SERVICE' }, capacity: { gte: partySize } },
    orderBy: { capacity: 'asc' },
  });

  // Check table conflicts to find an automatically assignable table
  let assignedTableId: string | null = null;
  for (const table of tables) {
    const conflict = await prisma.reservation.findFirst({
      where: {
        restaurantId: effectiveRestaurantId,
        branchId: effectiveBranchId,
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
      restaurantId: effectiveRestaurantId,
      branchId: effectiveBranchId,
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
      branch: { select: { id: true, name: true, city: true, address: true, phone: true } },
      table: { select: { id: true, tableNumber: true, name: true } },
    },
  });

  const reservationCode = `RES-${reservation.id.slice(-6).toUpperCase()}`;

  await notifyRestaurantStaff(
    effectiveRestaurantId,
    effectiveBranchId,
    'RESERVATION',
    'New online table reservation',
    `Online reservation for ${customerName} (${partySize} guests) on ${dateStr} at ${timeStr}.`,
    'RESERVATION',
    reservation.id
  );

  // Broadcast realtime event to staff
  const resEventPayload = {
    reservationId: reservation.id,
    reservationCode,
    customerName,
    partySize,
    date: dateStr,
    time: timeStr,
    status: reservation.status,
    tableNumber: reservation.table?.tableNumber || null,
  };
  realtimeService.broadcast(`reservations:${effectiveBranchId}`, 'new_reservation', resEventPayload);
  realtimeService.broadcast(`restaurant:${effectiveRestaurantId}`, 'new_reservation', resEventPayload);

  // Notify customer
  const restData = await prisma.restaurant.findUnique({ where: { id: effectiveRestaurantId }, select: { name: true } });
  const finalRestaurantName = restData?.name || branch.restaurant?.name || 'Melio';
  await notifyCustomerReservation({
    reference: reservationCode,
    customerName,
    customerPhone: phone || null,
    customerEmail: email || null,
    restaurantName: finalRestaurantName,
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
      phone: phone || null,
      email: email || null,
      partySize,
      date: dateStr,
      time: timeStr,
      startAt: reservation.startAt,
      endAt: reservation.endAt,
      status: reservation.status,
      restaurantName: finalRestaurantName,
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

  const include = {
    restaurant: { select: { name: true, phone: true } },
    branch: { select: { name: true, address: true, phone: true, city: true } },
    table: { select: { tableNumber: true } },
  };

  // Two ways to look a booking up:
  //  - the full reservation ID (a random UUID, returned when it was created), or
  //  - the short code (RES-XXXXXX) together with the phone/e-mail used to book.
  // A short code alone is guessable, so it is never enough on its own.
  let reservation = null;
  if (/^RES-[0-9A-F]{6}$/i.test(codeOrId)) {
    const contact = String(req.query.contact || '').trim().toLowerCase();
    const contactDigits = contact.replace(/\D/g, '');
    if (!contact) return sendError(res, 'Enter the phone number or e-mail used for the booking', undefined, 400);
    const candidates = await prisma.reservation.findMany({
      where: { id: { endsWith: codeOrId.slice(4).toLowerCase() } },
      include,
      take: 20,
    });
    const phoneMatches = (stored?: string | null) => {
      const digits = (stored || '').replace(/\D/g, '');
      return contactDigits.length >= 9 && digits.length >= 9 && digits.slice(-9) === contactDigits.slice(-9);
    };
    reservation = candidates.find((r) => (r.email && r.email.toLowerCase() === contact) || phoneMatches(r.phone)) || null;
  } else if (/^[0-9a-f-]{36}$/i.test(codeOrId)) {
    reservation = await prisma.reservation.findUnique({
      where: { id: codeOrId },
      include,
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

