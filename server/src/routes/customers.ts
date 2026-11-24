import { Router } from 'express';
import prisma from '../config/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { createAuditLog } from '../services/auditLogService';
import { customersByPhone, isOptedOut, kenyanPhone, maskPhone, smsMode, smsSenderId } from '../services/smsService';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();
router.use(authenticate);

const CUSTOMER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'];
const LOYALTY_MANAGER_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const POINTS_PER_100 = 1;

// Customer records hold personal data (phone, e-mail, address): front-of-house roles only.
router.get('/', authorize(...CUSTOMER_ROLES), async (req: AuthRequest, res) => {
  try {
    const q = String(req.query.search || '').trim();
    const customers = await prisma.customer.findMany({
      where: {
        restaurantId: req.user!.restaurantId,
        ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] } : {}),
      },
      include: { _count: { select: { orders: true } } },
      orderBy: { name: 'asc' },
    });
    return sendResponse(res, true, 'Customers retrieved', { customers });
  } catch (error) {
    console.error('Get customers failed:', error);
    return sendError(res, 'Unable to load customers.', undefined, 500);
  }
});

/** Whether SMS really goes out, and the latest messages (managers). */
router.get('/sms/status', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  const restaurantId = req.user!.restaurantId;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recent, counts, consenting, receipts] = await Promise.all([
    prisma.smsMessage.findMany({ where: { restaurantId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, phone: true, kind: true, body: true, status: true, error: true, createdAt: true, customer: { select: { id: true, name: true } } } }),
    prisma.smsMessage.groupBy({ by: ['status'], where: { restaurantId, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.customer.count({ where: { restaurantId, marketingConsent: true, smsOptOutAt: null } }),
    prisma.customer.count({ where: { restaurantId, smsReceipts: true, smsOptOutAt: null } }),
  ]);
  return sendResponse(res, true, 'SMS status', {
    mode: smsMode(),
    senderId: smsSenderId(),
    last30Days: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    customersWithReceipts: receipts,
    customersAgreedToOffers: consenting,
    recent: recent.map((m) => ({ ...m, phone: maskPhone(m.phone) })),
  });
});

// Keep this route before /:id so "loyalty/rules" is never treated as a customer id.
router.get('/loyalty/rules', async (_req: AuthRequest, res) => {
  return sendResponse(res, true, 'Loyalty rules retrieved', {
    pointsPer100Spent: POINTS_PER_100,
    redemption: 'Points may be redeemed manually by an authorized manager.',
  });
});

router.get('/:id', authorize(...CUSTOMER_ROLES), async (req: AuthRequest, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, restaurantId: req.user!.restaurantId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            branch: { select: { id: true, name: true, code: true } },
            items: { include: { modifiers: true } },
          },
        },
        loyaltyTransactions: { orderBy: { createdAt: 'desc' }, take: 100 },
        smsMessages: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, kind: true, body: true, status: true, error: true, createdAt: true } },
      },
    });

    if (!customer) return sendError(res, 'Customer not found', undefined, 404);

    const completedOrders = customer.orders.filter((order) => order.status === 'COMPLETED');
    const totalSpent = completedOrders.reduce((sum, order) => sum + order.totalAmount, 0);
    const lastOrder = completedOrders[0] || null;

    return sendResponse(res, true, 'Customer retrieved', {
      ...customer,
      stats: {
        orderCount: completedOrders.length,
        totalSpent,
        lastOrderDate: lastOrder?.completedAt || lastOrder?.createdAt || null,
      },
    });
  } catch (error) {
    console.error('Get customer failed:', error);
    return sendError(res, 'Unable to load customer.', undefined, 500);
  }
});

router.post('/', authorize(...CUSTOMER_ROLES), async (req: AuthRequest, res) => {
  try {
    const { name, phone, email, address, notes } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return sendError(res, 'Name is required');

    const trimmedPhone = phone?.trim() || null;
    const trimmedEmail = email?.trim() ? email.trim().toLowerCase() : null;

    if (trimmedPhone || trimmedEmail) {
      const duplicate = await prisma.customer.findFirst({
        where: {
          restaurantId: req.user!.restaurantId,
          OR: [
            ...(trimmedPhone ? [{ phone: trimmedPhone }] : []),
            ...(trimmedEmail ? [{ email: trimmedEmail }] : []),
          ],
        },
      });
      if (duplicate) {
        return sendError(res, 'A customer with this phone or email already exists in this restaurant', undefined, 409);
      }
    }
    const newIntl = kenyanPhone(trimmedPhone);
    if (newIntl && (await customersByPhone(req.user!.restaurantId, newIntl)).length) {
      return sendError(res, 'A customer with this phone number already exists in this restaurant', undefined, 409);
    }

    const customer = await prisma.customer.create({
      data: {
        restaurantId: req.user!.restaurantId,
        name: name.trim(),
        phone: trimmedPhone,
        email: trimmedEmail,
        address: address?.trim() || null,
        notes: notes?.trim() || null,
      },
    });
    return sendResponse(res, true, 'Customer created', customer, 201);
  } catch (error) {
    console.error('Create customer failed:', error);
    return sendError(res, 'Unable to save customer. Please check the database and try again.', undefined, 500);
  }
});

router.put('/:id', authorize(...CUSTOMER_ROLES), async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, restaurantId: req.user!.restaurantId } });
    if (!existing) return sendError(res, 'Customer not found', undefined, 404);

    const { name, phone, email, address, notes, status, language, smsReceipts, marketingConsent, smsOptOut } = req.body || {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) return sendError(res, 'Name is required');
    if (status !== undefined && !['ACTIVE', 'INACTIVE'].includes(status)) return sendError(res, 'Invalid customer status');
    if (language !== undefined && !['en', 'sw'].includes(language)) return sendError(res, 'Language must be English or Swahili');
    // SMS preferences. Offers need the customer's own yes; staff record it on their behalf.
    const smsData: Record<string, unknown> = {};
    if (language !== undefined) smsData.language = language;
    if (smsReceipts !== undefined) smsData.smsReceipts = !!smsReceipts;
    if (marketingConsent !== undefined && !!marketingConsent !== existing.marketingConsent) {
      Object.assign(smsData, marketingConsent
        ? { marketingConsent: true, marketingConsentAt: new Date(), marketingConsentSource: 'STAFF', marketingConsentBy: req.user!.id }
        : { marketingConsent: false });
    }
    if (smsOptOut === false && existing.smsOptOutAt) {
      // Lifting an opt-out is a manager's decision, and never over a STOP the customer texted.
      if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.roleName)) return sendError(res, 'Ask a manager to turn SMS back on for this customer', undefined, 403);
      if (existing.smsOptOutSource === 'SMS' || existing.smsOptOutSource === 'BLACKLIST') return sendError(res, 'The customer texted STOP. They can text START to turn SMS back on.', undefined, 409);
      Object.assign(smsData, { smsOptOutAt: null, smsOptOutSource: null });
    } else if (smsOptOut === true && !existing.smsOptOutAt) {
      Object.assign(smsData, { smsOptOutAt: new Date(), smsOptOutSource: 'STAFF', marketingConsent: false });
    }
    const intl = kenyanPhone(existing.phone);
    if ((marketingConsent === true || smsReceipts === true) && (existing.smsOptOutAt && smsOptOut !== false || (intl && (await isOptedOut(req.user!.restaurantId, intl, existing.id)) && smsOptOut !== false))) {
      return sendError(res, 'This customer asked for no SMS', undefined, 409);
    }

    const trimmedPhone = phone !== undefined ? (phone?.trim() || null) : existing.phone;
    const trimmedEmail = email !== undefined ? (email?.trim() ? email.trim().toLowerCase() : null) : existing.email;

    if (trimmedPhone || trimmedEmail) {
      const duplicate = await prisma.customer.findFirst({
        where: {
          restaurantId: req.user!.restaurantId,
          id: { not: existing.id },
          OR: [
            ...(trimmedPhone ? [{ phone: trimmedPhone }] : []),
            ...(trimmedEmail ? [{ email: trimmedEmail }] : []),
          ],
        },
      });
      if (duplicate) {
        return sendError(res, 'A customer with this phone or email already exists in this restaurant', undefined, 409);
      }
    }
    const intlPhone = kenyanPhone(trimmedPhone);
    if (intlPhone && (await customersByPhone(req.user!.restaurantId, intlPhone)).some((cid) => cid !== existing.id)) {
      return sendError(res, 'A customer with this phone number already exists in this restaurant', undefined, 409);
    }

    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        phone: trimmedPhone,
        email: trimmedEmail,
        ...(address !== undefined ? { address: address?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        ...(status !== undefined ? { status } : {}),
        ...smsData,
      },
    });

    const smsLog = [
      language !== undefined && language !== existing.language ? `language ${language}` : '',
      smsReceipts !== undefined && !!smsReceipts !== existing.smsReceipts ? `receipts ${smsReceipts ? 'on' : 'off'}` : '',
      'marketingConsent' in smsData ? `offers ${smsData.marketingConsent ? 'agreed' : 'withdrawn'}` : '',
      'smsOptOutAt' in smsData ? (smsData.smsOptOutAt ? 'no SMS at all' : 'SMS allowed again') : '',
    ].filter(Boolean).join(', ');
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Customer', customer.id, `Updated customer ${customer.name}${smsLog ? ` (SMS: ${smsLog})` : ''}`);
    return sendResponse(res, true, 'Customer updated', customer);
  } catch (error) {
    console.error('Update customer failed:', error);
    return sendError(res, 'Unable to update customer.', undefined, 500);
  }
});

router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.customer.findFirst({ where: { id: req.params.id, restaurantId: req.user!.restaurantId } });
    if (!existing) return sendError(res, 'Customer not found', undefined, 404);

    const customer = await prisma.customer.update({ where: { id: existing.id }, data: { status: 'INACTIVE' } });
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Customer', customer.id, `Deactivated customer ${customer.name}`);
    return sendResponse(res, true, 'Customer deactivated', customer);
  } catch (error) {
    console.error('Deactivate customer failed:', error);
    return sendError(res, 'Unable to deactivate customer.', undefined, 500);
  }
});

router.post('/:id/loyalty/adjust', authorize(...LOYALTY_MANAGER_ROLES), async (req: AuthRequest, res) => {
  try {
    const customerId = req.params.id;
    const points = Number(req.body?.points);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

    if (!Number.isInteger(points) || points === 0) return sendError(res, 'Points must be a non-zero whole number');

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, restaurantId: req.user!.restaurantId } });
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
      if (customer.loyaltyBalance + points < 0) throw new Error('INSUFFICIENT_POINTS');

      const updated = await tx.customer.update({ where: { id: customer.id }, data: { loyaltyBalance: { increment: points } } });
      const transaction = await tx.loyaltyTransaction.create({
        data: {
          restaurantId: req.user!.restaurantId,
          customerId: customer.id,
          points,
          type: points > 0 ? 'MANUAL_ADJUSTMENT_CREDIT' : 'MANUAL_ADJUSTMENT_DEBIT',
          note: note || 'Manual loyalty adjustment',
        },
      });
      return { customer: updated, transaction };
    });

    await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Customer', customerId, `Adjusted loyalty points by ${points}`);
    return sendResponse(res, true, 'Loyalty points adjusted', result);
  } catch (error: any) {
    if (error?.message === 'CUSTOMER_NOT_FOUND') return sendError(res, 'Customer not found', undefined, 404);
    if (error?.message === 'INSUFFICIENT_POINTS') return sendError(res, 'Customer does not have enough loyalty points');
    console.error('Adjust loyalty failed:', error);
    return sendError(res, 'Unable to adjust loyalty points.', undefined, 500);
  }
});

router.post('/:id/loyalty/redeem', authorize(...LOYALTY_MANAGER_ROLES), async (req: AuthRequest, res) => {
  try {
    const customerId = req.params.id;
    const points = Number(req.body?.points);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!Number.isInteger(points) || points <= 0) return sendError(res, 'Points to redeem must be a positive whole number');

    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, restaurantId: req.user!.restaurantId } });
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
      if (customer.loyaltyBalance < points) throw new Error('INSUFFICIENT_POINTS');

      const updated = await tx.customer.update({ where: { id: customer.id }, data: { loyaltyBalance: { decrement: points } } });
      const transaction = await tx.loyaltyTransaction.create({
        data: {
          restaurantId: req.user!.restaurantId,
          customerId: customer.id,
          points: -points,
          type: 'REDEMPTION',
          note: note || 'Loyalty points redeemed',
        },
      });
      return { customer: updated, transaction };
    });

    await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Customer', customerId, `Redeemed ${points} loyalty points`);
    return sendResponse(res, true, 'Loyalty points redeemed', result);
  } catch (error: any) {
    if (error?.message === 'CUSTOMER_NOT_FOUND') return sendError(res, 'Customer not found', undefined, 404);
    if (error?.message === 'INSUFFICIENT_POINTS') return sendError(res, 'Customer does not have enough loyalty points');
    console.error('Redeem loyalty failed:', error);
    return sendError(res, 'Unable to redeem loyalty points.', undefined, 500);
  }
});

export default router;
