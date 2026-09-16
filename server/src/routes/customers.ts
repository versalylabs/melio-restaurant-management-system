import { Router } from 'express';
import prisma from '../config/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { createAuditLog } from '../services/auditLogService';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();
router.use(authenticate);

const CUSTOMER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'];
const LOYALTY_MANAGER_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const POINTS_PER_100 = 1;

router.get('/', async (req: AuthRequest, res) => {
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

// Keep this route before /:id so "loyalty/rules" is never treated as a customer id.
router.get('/loyalty/rules', async (_req: AuthRequest, res) => {
  return sendResponse(res, true, 'Loyalty rules retrieved', {
    pointsPer100Spent: POINTS_PER_100,
    redemption: 'Points may be redeemed manually by an authorized manager.',
  });
});

router.get('/:id', async (req: AuthRequest, res) => {
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
    const customer = await prisma.customer.create({
      data: {
        restaurantId: req.user!.restaurantId,
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
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

    const { name, phone, email, address, notes, status } = req.body || {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) return sendError(res, 'Name is required');
    if (status !== undefined && !['ACTIVE', 'INACTIVE'].includes(status)) return sendError(res, 'Invalid customer status');

    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(email !== undefined ? { email: email?.trim() || null } : {}),
        ...(address !== undefined ? { address: address?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });

    await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Customer', customer.id, `Updated customer ${customer.name}`);
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
