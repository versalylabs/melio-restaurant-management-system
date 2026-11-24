import crypto from 'crypto';
import prisma from '../config/database';
import { calculateOrderTotals, taxFields, OrderCalculationInput } from './orderCalculationService';
import { channelFields } from './channelService';
import { validatePromotion } from './promotionService';
import { createKitchenTicketForOrder } from './kitchenService';
import { notifyRestaurantStaff } from './notificationService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate, notifyCustomerReservation } from './customerNotificationService';
import { isPaymentSimulationEnabled, settleOnlinePayment } from './onlinePaymentService';
import { sendError, sendResponse } from '../utils/response';
import { resolvePublicCustomer } from './customerAuthService';
import { ensureTableAvailable } from './reservationService';
import { getRestaurantTimeZone, zonedDateTimeToUtc } from '../utils/timezone';
import { isUniqueViolationOn, normalizeClientRequestId } from '../utils/idempotency';
import { Request, Response } from 'express';

const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY'];
const FULFILLMENT_TYPES = ['PICKUP', 'DELIVERY'];

const token = () => crypto.randomBytes(18).toString('hex');

export const getPublicRestaurants = async (_req: Request, res: Response) => {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, name: true, description: true, phone: true, email: true, address: true, city: true, currency: true, logo: true, whatsappNumber: true,
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
    include: {
      category: { select: { id: true, name: true } },
      branchAvailabilities: { where: { branchId }, select: { available: true } },
      modifierGroups: { where: { modifierGroup: { status: 'ACTIVE' } }, include: { modifierGroup: { include: { options: { where: { status: 'ACTIVE' }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] } } } } },
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });

  return sendResponse(res, true, 'Public menu retrieved', {
    restaurant, branch, categories,
    items: items.map(({ branchAvailabilities, modifierGroups, costPrice, ...item }) => ({
      ...item,
      branchAvailable: branchAvailabilities[0]?.available ?? true,
      // Options the customer can choose (extra cheese, no onions, spice level).
      modifierGroups: modifierGroups
        .map(({ modifierGroup: g }) => ({
          id: g.id, name: g.name, selectionType: g.selectionType, isRequired: g.isRequired, displayOrder: g.displayOrder,
          options: g.options.map((o) => ({ id: o.id, name: o.name, priceAdjustment: o.priceAdjustment })),
        }))
        .filter((g) => g.options.length)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    })),
  });
};

/**
 * Prices an online cart exactly as the order will be charged: current menu
 * prices, the branch's availability, tax, service charge and any promo code.
 * Used by both the checkout quote and order creation so the amount the
 * customer sees before paying is the amount on the M-Pesa prompt.
 */
type PricedCart =
  | { ok: false; message: string; status?: number }
  | {
      ok: true;
      normalized: Array<{ menuItemId: string; quantity: number; modifiers: Array<{ modifierOptionId: string; optionNameSnapshot: string; priceAdjustment: number }> }>;
      menuMap: Map<string, { id: string; name: string; sellingPrice: number }>;
      promotion: any;
      promotionId?: string;
      promoCode: string;
      totals: Awaited<ReturnType<typeof calculateOrderTotals>>;
    };

async function pricePublicCart(params: { restaurantId: string; branchId: string; items: any[]; promoCode?: string; customerId?: string }): Promise<PricedCart> {
  const { restaurantId, branchId, items, customerId } = params;
  if (!items.length) return { ok: false, message: 'Your cart is empty' };
  if (items.length > 100) return { ok: false, message: 'Too many items in one order' };
  const requested = items.map((item: any) => ({
    menuItemId: String(item?.menuItemId || ''),
    quantity: Math.max(1, Math.min(50, Math.floor(Number(item?.quantity || 1)))),
    optionIds: Array.isArray(item?.modifiers) ? [...new Set(item.modifiers.map((m: any) => String(typeof m === 'string' ? m : m?.modifierOptionId || '')).filter(Boolean))].slice(0, 20) as string[] : [],
  }));
  if (requested.some((item) => !item.menuItemId)) return { ok: false, message: 'Invalid menu item' };

  const menuItemIds: string[] = [...new Set(requested.map((item) => item.menuItemId))];
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, restaurantId, status: 'ACTIVE', available: true, branchAvailabilities: { none: { branchId, available: false } } },
    select: {
      id: true, name: true, sellingPrice: true,
      modifierGroups: { where: { modifierGroup: { status: 'ACTIVE' } }, select: { modifierGroup: { select: { id: true, name: true, selectionType: true, isRequired: true, options: { where: { status: 'ACTIVE' }, select: { id: true, name: true, priceAdjustment: true } } } } } },
    },
  });
  if (menuItems.length !== menuItemIds.length) return { ok: false, message: 'One or more menu items are no longer available' };
  const menuMap = new Map(menuItems.map((item) => [item.id, item]));

  // Options are checked against the dish's own groups: only real options, one
  // per single-choice group, and every required group answered.
  const normalized: Array<{ menuItemId: string; quantity: number; modifiers: Array<{ modifierOptionId: string; optionNameSnapshot: string; priceAdjustment: number }> }> = [];
  for (const line of requested) {
    const dish = menuMap.get(line.menuItemId)!;
    const groups = dish.modifierGroups.map((g) => g.modifierGroup).filter((g) => g.options.length);
    const chosen: Array<{ modifierOptionId: string; optionNameSnapshot: string; priceAdjustment: number }> = [];
    for (const optionId of line.optionIds) {
      const group = groups.find((g) => g.options.some((o) => o.id === optionId));
      if (!group) return { ok: false, message: `An option for ${dish.name} is no longer available. Remove it and add it again.` };
      const option = group.options.find((o) => o.id === optionId)!;
      chosen.push({ modifierOptionId: option.id, optionNameSnapshot: option.name, priceAdjustment: option.priceAdjustment });
    }
    for (const g of groups) {
      const picked = g.options.filter((o) => line.optionIds.includes(o.id)).length;
      if (g.isRequired && picked === 0) return { ok: false, message: `Choose ${g.name.toLowerCase()} for ${dish.name}` };
      if (g.selectionType === 'SINGLE' && picked > 1) return { ok: false, message: `Choose only one ${g.name.toLowerCase()} for ${dish.name}` };
    }
    normalized.push({ menuItemId: line.menuItemId, quantity: line.quantity, modifiers: chosen });
  }
  const linePrice = (line: (typeof normalized)[number]) => menuMap.get(line.menuItemId)!.sellingPrice + line.modifiers.reduce((t, m) => t + Math.max(0, m.priceAdjustment), 0);

  let promotion: any = undefined;
  let promotionId: string | undefined;
  const promoCode = String(params.promoCode || '').trim();
  const baseSubtotal = normalized.reduce((sum, item) => sum + linePrice(item) * item.quantity, 0);
  if (promoCode) {
    const found = await prisma.promotion.findFirst({ where: { restaurantId, active: true, code: { equals: promoCode } } });
    if (!found) return { ok: false, message: 'Promotion code is invalid' };
    try {
      // Before the customer is known, customer-only codes are checked later by
      // the caller (createPublicOrder) once the customer is resolved.
      promotion = await validatePromotion(found.id, restaurantId, branchId, customerId, baseSubtotal, new Date(), { skipCustomerCheck: !customerId });
      promotionId = found.id;
    } catch (promoErr: any) {
      return { ok: false, message: promoErr.message || 'Invalid promotion code' };
    }
  }

  const calcItems = normalized.map((item) => ({
    menuItemId: item.menuItemId,
    unitPrice: menuMap.get(item.menuItemId)!.sellingPrice,
    quantity: item.quantity,
    modifiers: item.modifiers.map((m) => ({ modifierOptionId: m.modifierOptionId, priceAdjustment: m.priceAdjustment })),
  }));
  const totals = await calculateOrderTotals({ items: calcItems, discountAmount: 0, discountType: 'FIXED', restaurantId, branchId, promotion: promotion ? { discountType: promotion.discountType, value: promotion.value, scope: promotion.scope, menuItemId: promotion.menuItemId, maxDiscountAmount: promotion.maxDiscountAmount } : undefined } as OrderCalculationInput);
  return { ok: true, normalized, menuMap, promotion, promotionId, promoCode, totals };
}

/** Checkout preview: the exact amount the order will cost. Creates nothing. */
export const quotePublicOrder = async (req: Request, res: Response) => {
  const body = req.body || {};
  const restaurantId = String(body.restaurantId || '').trim();
  const branchId = String(body.branchId || '').trim();
  if (!restaurantId || !branchId) return sendError(res, 'Restaurant and branch are required');
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId, status: 'ACTIVE' }, select: { id: true } });
  if (!branch) return sendError(res, 'Selected branch is unavailable', undefined, 404);

  const priced = await pricePublicCart({ restaurantId, branchId, items: Array.isArray(body.items) ? body.items : [], promoCode: body.promoCode });
  if (!priced.ok) return sendError(res, priced.message, undefined, priced.status || 400);
  const t = priced.totals;
  return sendResponse(res, true, 'Order quote', {
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxAmount: t.taxAmount,
    serviceChargeAmount: t.serviceChargeAmount,
    totalAmount: t.totalAmount,
    taxInclusive: t.taxInclusive,
    promoApplied: !!priced.promotionId,
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

  // A retried checkout (double tap, flaky mobile data) returns the order that
  // already exists instead of placing and charging a second one.
  const clientRequestId = normalizeClientRequestId(body.clientRequestId);
  const replyWithExisting = async () => {
    if (!clientRequestId) return null;
    const existing = await prisma.sale.findUnique({
      where: { restaurantId_clientRequestId: { restaurantId, clientRequestId } },
      include: { onlineOrder: true },
    });
    if (!existing?.onlineOrder) return null;
    const o = existing.onlineOrder;
    return sendResponse(res, true, 'Online order already placed', { orderId: existing.id, orderNumber: existing.orderNumber, trackingToken: o.trackingToken, totalAmount: existing.totalAmount, paymentState: o.paymentState, trackingUrl: `/online-order/${o.trackingToken}` }, 200);
  };
  const earlier = await replyWithExisting();
  if (earlier) return earlier;

  // Price and validate the cart before touching customer records, so a bad
  // cart never creates a guest profile.
  const priced = await pricePublicCart({ restaurantId, branchId, items, promoCode: body.promoCode });
  if (!priced.ok) return sendError(res, priced.message, undefined, priced.status || 400);
  const { normalized, menuMap, promotion, promotionId, promoCode, totals } = priced;

  // Order contact details (name, phone, address) are stored on the order itself;
  // the customer record is only linked, never overwritten from a public form.
  const customer = await resolvePublicCustomer(req, restaurantId, { name: customerName, phone: contactPhone, email: contactEmail, address: deliveryAddress, notes: 'Created from online ordering' });

  // Customer-specific promotion rules (one per customer, members only) need
  // the resolved customer.
  if (promotionId) {
    try {
      await validatePromotion(promotionId, restaurantId, branchId, customer.id, totals.subtotal);
    } catch (promoErr: any) {
      return sendError(res, promoErr.message || 'Invalid promotion code', undefined, 400);
    }
  }

  const systemUser = await prisma.user.findFirst({ where: { restaurantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!systemUser) return sendError(res, 'Online ordering is not configured for this restaurant', undefined, 409);

  const trackingToken = token();
  const websiteChannel = await channelFields(restaurantId, 'WEBSITE', totals.totalAmount);
  let result: any;
  try {
  result = await prisma.$transaction(async (tx) => {
    const counter = await tx.orderCounter.upsert({
      where: { restaurantId_branchId: { restaurantId, branchId } },
      create: { restaurantId, branchId, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    const next = counter.lastNumber;

    const order = await tx.sale.create({
      data: {
        restaurantId, branchId, orderNumber: `#${next}`, clientRequestId, orderType: fulfillmentType === 'DELIVERY' ? 'DELIVERY' : 'PICKUP', customerId: customer!.id, customerName,
        status: 'SUBMITTED', paymentStatus: 'UNPAID', amountPaid: 0,
        subtotal: totals.subtotal, discountAmount: totals.discountAmount, discountReason: promotion ? `Promotion: ${promoCode}` : null,
        promotionId: promotionId || null, taxAmount: totals.taxAmount, ...taxFields(totals), serviceChargeAmount: totals.serviceChargeAmount, totalAmount: totals.totalAmount, ...websiteChannel,
        notes: notes || null, createdBy: systemUser.id,
        items: {
          create: normalized.map((item) => {
            const menu = menuMap.get(item.menuItemId)!;
            const unit = menu.sellingPrice + item.modifiers.reduce((t, m) => t + Math.max(0, m.priceAdjustment), 0);
            return {
              menuItemId: menu.id, itemNameSnapshot: menu.name, unitPrice: menu.sellingPrice, quantity: item.quantity,
              subtotal: Math.round(unit * item.quantity * 100) / 100,
              ...(item.modifiers.length ? { modifiers: { create: item.modifiers } } : {}),
            };
          }),
        },
      },
      include: { items: true },
    });
    await tx.saleStatusHistory.create({ data: { saleId: order.id, status: 'SUBMITTED', changedBy: systemUser.id, notes: 'Order placed via online ordering' } });
    await tx.onlineOrder.create({ data: { restaurantId, branchId, saleId: order.id, fulfillmentType, deliveryAddress: fulfillmentType === 'DELIVERY' ? deliveryAddress : null, contactPhone: contactPhone || null, contactEmail: contactEmail || null, paymentMethod, paymentState: paymentMethod === 'CASH' ? 'PAY_AT_PICKUP' : 'PENDING', trackingToken, customerNotes: notes || null } });
    if (paymentMethod !== 'CASH') await tx.payment.create({ data: { restaurantId, branchId, saleId: order.id, method: paymentMethod, amount: totals.totalAmount, status: 'PENDING', notes: 'Online payment pending provider confirmation', createdBy: systemUser.id } });
    return order;
  });
  } catch (err: any) {
    if (isUniqueViolationOn(err, 'clientRequestId')) {
      const winner = await replyWithExisting();
      if (winner) return winner;
    }
    throw err;
  }

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
  // No fallback to "any branch": a booking must never land in another restaurant.
  if (!branch) return sendError(res, 'Selected branch is unavailable', undefined, 404);

  const effectiveRestaurantId = branch.restaurantId;
  const effectiveBranchId = branch.id;

  // The guest picks a local date and time ("19:00" in Nairobi), not UTC.
  const startAt = zonedDateTimeToUtc(dateStr, timeStr, await getRestaurantTimeZone(effectiveRestaurantId));
  if (!startAt) return sendError(res, 'Invalid reservation date or time format');
  if (startAt.getTime() < Date.now() - 5 * 60_000) return sendError(res, 'Please choose a time in the future');
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
  if (!systemUser) return sendError(res, 'Reservations are not configured for this restaurant', undefined, 409);

  const notesText = [
    seatingArea ? `[Seating: ${seatingArea}]` : '',
    specialRequests ? specialRequests : '',
  ].filter(Boolean).join(' ');

  let reservation;
  try {
    reservation = await prisma.$transaction(async (tx) => {
      const branchTableCount = await tx.table.count({ where: { branchId: effectiveBranchId, restaurantId: effectiveRestaurantId, status: { notIn: ['OUT_OF_SERVICE', 'INACTIVE'] } } });
      const tables = await tx.table.findMany({
        where: { branchId: effectiveBranchId, restaurantId: effectiveRestaurantId, status: { notIn: ['OUT_OF_SERVICE', 'INACTIVE'] }, capacity: { gte: partySize } },
        orderBy: [{ capacity: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });

      // Smallest free table that fits. Each candidate is locked before it is
      // checked, so two guests can't be given the same table for the same time.
      let assignedTableId: string | null = null;
      for (const table of tables) {
        try {
          await ensureTableAvailable(tx, effectiveRestaurantId, effectiveBranchId, table.id, startAt, endAt);
          assignedTableId = table.id;
          break;
        } catch (e: any) {
          if (e.message !== 'TABLE_CONFLICT') throw e;
        }
      }

      // Every suitable table is taken: refuse instead of overbooking. (Branches
      // without tables set up, or parties bigger than any table, still go
      // through as an unassigned request for staff to arrange.)
      if (!assignedTableId && tables.length > 0) throw new Error('FULLY_BOOKED');
      if (!assignedTableId && branchTableCount > 0) {
        console.info(`[Reservations] Party of ${partySize} is larger than any table at branch ${effectiveBranchId}; saved unassigned for staff.`);
      }

      return tx.reservation.create({
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
    }, { timeout: 15_000 });
  } catch (e: any) {
    if (e?.message === 'FULLY_BOOKED') return sendError(res, 'Sorry, we are fully booked at that time. Please choose another time.', undefined, 409);
    throw e;
  }

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
    where: { branchId, restaurantId, status: { notIn: ['OUT_OF_SERVICE', 'INACTIVE'] }, capacity: { gte: partySize } },
    select: { id: true },
  });

  const timeZone = await getRestaurantTimeZone(restaurantId);
  if (!zonedDateTimeToUtc(dateStr, '00:00', timeZone)) return sendError(res, 'Invalid date');
  const slots = ['12:00', '12:30', '13:00', '13:30', '14:00', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
  const availability = await Promise.all(
    slots.map(async (slot) => {
      const slotStart = zonedDateTimeToUtc(dateStr, slot, timeZone)!;
      const slotEnd = new Date(slotStart.getTime() + 90 * 60000);

      // Eligible tables (big enough) that have no overlapping active booking.
      const busy = await prisma.reservation.findMany({
        where: {
          restaurantId,
          branchId,
          tableId: { in: tables.map((t) => t.id) },
          status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
          startAt: { lt: slotEnd },
          endAt: { gt: slotStart },
        },
        select: { tableId: true },
        distinct: ['tableId'],
      });

      const availableTablesCount = Math.max(0, tables.length - busy.length);
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

