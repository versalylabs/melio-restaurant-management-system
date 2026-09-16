import { Router } from 'express';
import prisma from '../config/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { createAuditLog } from '../services/auditLogService';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();
router.use(authenticate);
const PAYMENT_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
const REFUND_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const METHODS = ['CASH', 'CARD', 'MOBILE_MONEY'];

async function syncPaymentState(tx: any, saleId: string) {
  const sale = await tx.sale.findUnique({ where: { id: saleId } });
  if (!sale) throw new Error('ORDER_NOT_FOUND');
  const payments = await tx.payment.findMany({ where: { saleId, status: 'COMPLETED' } });
  const paid = payments.reduce((sum: number, p: any) => sum + p.amount, 0);
  const paymentStatus = paid <= 0 ? 'UNPAID' : paid + 0.005 < sale.totalAmount ? 'PARTIAL' : 'PAID';
  await tx.sale.update({ where: { id: saleId }, data: { amountPaid: paid, paymentStatus } });
  return { paid, paymentStatus, balance: Math.max(0, sale.totalAmount - paid) };
}

async function ensureReceipt(tx: any, sale: any) {
  const existing = await tx.receipt.findUnique({ where: { saleId: sale.id } });
  if (existing) return existing;
  const counter = await tx.receiptCounter.findUnique({ where: { restaurantId_branchId: { restaurantId: sale.restaurantId, branchId: sale.branchId } } });
  const next = (counter?.lastNumber || 0) + 1;
  if (counter) await tx.receiptCounter.update({ where: { restaurantId_branchId: { restaurantId: sale.restaurantId, branchId: sale.branchId } }, data: { lastNumber: next } });
  else await tx.receiptCounter.create({ data: { restaurantId: sale.restaurantId, branchId: sale.branchId, lastNumber: next } });
  return tx.receipt.create({ data: { restaurantId: sale.restaurantId, branchId: sale.branchId, saleId: sale.id, receiptNumber: `R-${String(next).padStart(6, '0')}` } });
}

router.get('/', async (req: AuthRequest, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const method = String(req.query.method || '').trim();
    const status = String(req.query.status || '').trim();
    const payments = await prisma.payment.findMany({
      where: { restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}), ...(method ? { method } : {}), ...(status ? { status } : {}), ...(search ? { OR: [{ reference: { contains: search } }, { sale: { orderNumber: { contains: search } } }] } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { sale: { select: { id: true, orderNumber: true, totalAmount: true, paymentStatus: true, customerName: true } } },
    });
    return sendResponse(res, true, 'Payments retrieved', payments);
  } catch (e) { console.error(e); return sendError(res, 'Unable to load payments.', undefined, 500); }
});

router.get('/order/:orderId', async (req: AuthRequest, res) => {
  try {
    const sale = await prisma.sale.findFirst({ where: { id: req.params.orderId, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) }, include: { payments: { orderBy: { createdAt: 'desc' } }, receipt: true, items: true, branch: true, customer: true } });
    if (!sale) return sendError(res, 'Order not found', undefined, 404);
    const paid = sale.payments.filter((p: any) => p.status === 'COMPLETED').reduce((s: number, p: any) => s + p.amount, 0);
    const paymentStatus = paid <= 0 ? 'UNPAID' : paid + 0.005 < sale.totalAmount ? 'PARTIAL' : 'PAID';
    return sendResponse(res, true, 'Order payment details retrieved', { sale: { ...sale, amountPaid: paid, paymentStatus }, paid, balance: Math.max(0, sale.totalAmount - paid), paymentStatus });
  } catch (e) { console.error(e); return sendError(res, 'Unable to load payment details.', undefined, 500); }
});

router.post('/orders/:orderId', authorize(...PAYMENT_ROLES), async (req: AuthRequest, res) => {
  try {
    const { method, amount, amountTendered, reference, notes } = req.body || {};
    if (!METHODS.includes(method)) return sendError(res, 'Invalid payment method');
    const requested = Number(amount);
    if (!Number.isFinite(requested) || requested <= 0) return sendError(res, 'Payment amount must be greater than zero');

    let tendered = amountTendered == null ? requested : Number(amountTendered);
    if (!Number.isFinite(tendered) || tendered < requested) return sendError(res, 'Amount tendered must be at least the payment amount');
    const change = method === 'CASH' ? tendered - requested : 0;

    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: req.params.orderId, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
        include: { payments: { where: { status: 'COMPLETED' } } },
      });
      if (!sale) throw new Error('ORDER_NOT_FOUND');
      if (sale.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

      const paid = sale.payments.reduce((s: number, p: any) => s + p.amount, 0);
      const balance = Math.max(0, sale.totalAmount - paid);
      if (requested > balance + 0.005) {
        throw new Error(`PAYMENT_EXCEEDS_BALANCE:${balance.toFixed(2)}`);
      }

      const payment = await tx.payment.create({
        data: {
          restaurantId: req.user!.restaurantId,
          branchId: sale.branchId,
          saleId: sale.id,
          method,
          amount: requested,
          amountTendered: tendered,
          changeAmount: change,
          reference: reference?.trim() || null,
          notes: notes?.trim() || null,
          createdBy: req.user!.id,
        },
      });
      const state = await syncPaymentState(tx, sale.id);
      let receipt = null;
      if (state.paymentStatus === 'PAID') receipt = await ensureReceipt(tx, sale);
      return { payment, ...state, receipt, orderNumber: sale.orderNumber };
    });

    await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'Payment', result.payment.id, `Recorded ${method} payment of KES ${requested.toFixed(2)} for ${result.orderNumber}`);
    return sendResponse(res, true, 'Payment recorded', result, 201);
  } catch (e: any) {
    if (e?.message === 'ORDER_NOT_FOUND') return sendError(res, 'Order not found', undefined, 404);
    if (e?.message === 'ORDER_CANCELLED') return sendError(res, 'Cancelled orders cannot be paid', undefined, 400);
    if (e?.message?.startsWith('PAYMENT_EXCEEDS_BALANCE:')) {
      const bal = e.message.split(':')[1];
      return sendError(res, `Payment exceeds the remaining balance of KES ${bal}`, undefined, 400);
    }
    console.error('Record payment failed:', e);
    return sendError(res, 'Unable to record payment.', undefined, 500);
  }
});

router.post('/:id/refund', authorize(...REFUND_ROLES), async (req: AuthRequest, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return sendError(res, 'Refund reason is required');
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id: req.params.id, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
      if (!payment) throw new Error('PAYMENT_NOT_FOUND');
      if (payment.status !== 'COMPLETED') throw new Error('PAYMENT_ALREADY_REFUNDED');
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', refundedAt: new Date(), refundReason: reason } });
      const state = await syncPaymentState(tx, payment.saleId);
      return { paymentId: payment.id, ...state };
    });
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'REFUND', 'Payment', req.params.id, `Refunded payment: ${reason}`);
    return sendResponse(res, true, 'Payment refunded', result);
  } catch (e: any) {
    if (e?.message === 'PAYMENT_NOT_FOUND') return sendError(res, 'Payment not found', undefined, 404);
    if (e?.message === 'PAYMENT_ALREADY_REFUNDED') return sendError(res, 'Payment has already been refunded');
    console.error(e); return sendError(res, 'Unable to refund payment.', undefined, 500);
  }
});

router.get('/orders/:orderId/receipt', async (req: AuthRequest, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id: req.params.orderId, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) }, include: { items: true, payments: { where: { status: 'COMPLETED' }, orderBy: { createdAt: 'asc' } }, receipt: true, branch: true, customer: true } });
      if (!sale) throw new Error('ORDER_NOT_FOUND');
      const paid = sale.payments.reduce((s: number, p: any) => s + p.amount, 0);
      if (paid + 0.005 < sale.totalAmount) throw new Error('ORDER_NOT_PAID');
      const receipt = sale.receipt || await ensureReceipt(tx, sale);
      const updatedReceipt = await tx.receipt.update({ where: { id: receipt.id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
      return { sale, receipt: updatedReceipt };
    });
    return sendResponse(res, true, 'Receipt retrieved', result);
  } catch (e: any) {
    if (e?.message === 'ORDER_NOT_FOUND') return sendError(res, 'Order not found', undefined, 404);
    if (e?.message === 'ORDER_NOT_PAID') return sendError(res, 'A receipt is available only after the order is fully paid');
    console.error(e); return sendError(res, 'Unable to load receipt.', undefined, 500);
  }
});

export default router;
