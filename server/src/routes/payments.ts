import { Router } from 'express';
import prisma from '../config/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { createAuditLog } from '../services/auditLogService';
import { createKitchenTicketForOrder } from '../services/kitchenService';
import { ensureReceipt, lockSale, syncPaymentState } from '../services/saleLedgerService';
import { completeOrder } from '../services/orderCompletionService';
import { confirmSimulatedMpesaPayment, getStaffMpesaStatus, initiateStaffMpesaPrompt, mpesaReceiptLockKey, PROMPT_IN_FLIGHT_MS, reverifyAwaitingPayment } from '../services/mpesaService';
import { isPaymentSimulationEnabled, PaymentError } from '../services/onlinePaymentService';
import { realtimeService } from '../services/realtimeService';
import { sendApprovalError, verifyApproval } from '../services/approvalService';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();
router.use(authenticate);
const PAYMENT_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
// Cashiers can refund too, but every refund needs a manager's PIN.
const REFUND_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
// Waiters can see an order's payment status and receipt, but not the full payments ledger.
const ORDER_PAYMENT_VIEW_ROLES = [...PAYMENT_ROLES, 'WAITER'];
const METHODS = ['CASH', 'CARD', 'MOBILE_MONEY'];

/**
 * M-Pesa transaction codes are 10 letters and digits (e.g. SKL7H2X9QD). A
 * code typed in by staff must be in that shape and must never have been used
 * on any order before: a forwarded or edited confirmation SMS can't pay twice.
 */
const MPESA_CODE = /^[A-Z0-9]{10}$/;
export const normaliseMpesaCode = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

class PaymentInputError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

const sendMpesaError = (res: any, err: unknown) => {
  if (err instanceof PaymentError) return sendError(res, err.message, undefined, err.statusCode);
  console.error('M-Pesa prompt failed:', err);
  return sendError(res, "Couldn't reach M-Pesa. Check the connection and try again, or take the M-Pesa code instead.", undefined, 502);
};

/** Send an M-Pesa prompt to the customer's phone for this bill (or part of it). */
router.post('/orders/:orderId/mpesa-prompt', authorize(...ORDER_PAYMENT_VIEW_ROLES), async (req: AuthRequest, res) => {
  try {
    const { phoneNumber, amount } = req.body || {};
    const result = await initiateStaffMpesaPrompt({
      saleId: req.params.orderId,
      restaurantId: req.user!.restaurantId,
      branchId: req.user!.branchId,
      userId: req.user!.id,
      phoneNumber: typeof phoneNumber === 'string' ? phoneNumber : '',
      amount: amount === undefined || amount === null || amount === '' ? undefined : Number(amount),
    });
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'Payment', req.params.orderId, `Sent an M-Pesa prompt of KES ${result.amount} to ${result.phoneNumber} for order ${result.orderNumber}`);
    return sendResponse(res, true, `Prompt sent to ${result.phoneNumber}. Ask the customer to enter their M-Pesa PIN.`, result, 201);
  } catch (err) {
    return sendMpesaError(res, err);
  }
});

/** Where a prompt stands, for the screen waiting on it. */
router.get('/mpesa/:checkoutRequestId', authorize(...ORDER_PAYMENT_VIEW_ROLES), async (req: AuthRequest, res) => {
  const status = await getStaffMpesaStatus(req.params.checkoutRequestId, req.user!.restaurantId, req.user!.branchId);
  if (!status) return sendError(res, 'Prompt not found', undefined, 404);
  return sendResponse(res, true, 'M-Pesa prompt status', status);
});

/** Test mode only: pretend the customer entered their PIN. */
router.post('/mpesa/:checkoutRequestId/simulate', authorize(...ORDER_PAYMENT_VIEW_ROLES), async (req: AuthRequest, res) => {
  if (!isPaymentSimulationEnabled()) return sendError(res, 'Only available in test mode', undefined, 403);
  const status = await getStaffMpesaStatus(req.params.checkoutRequestId, req.user!.restaurantId, req.user!.branchId);
  if (!status) return sendError(res, 'Prompt not found', undefined, 404);
  try {
    const result = await confirmSimulatedMpesaPayment(req.params.checkoutRequestId);
    return sendResponse(res, true, 'Simulated payment confirmed', result);
  } catch (err) {
    return sendMpesaError(res, err);
  }
});

router.get('/', authorize(...PAYMENT_ROLES), async (req: AuthRequest, res) => {
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

router.get('/order/:orderId', authorize(...ORDER_PAYMENT_VIEW_ROLES), async (req: AuthRequest, res) => {
  try {
    // M-Pesa payments whose callback couldn't be verified with Safaricom at the
    // time are re-checked here, so they settle even if the customer closed the page.
    const awaiting = await prisma.payment.findMany({
      where: { saleId: req.params.orderId, restaurantId: req.user!.restaurantId, method: 'MOBILE_MONEY', status: 'PENDING', notes: { contains: '[AWAITING_VERIFICATION' } },
      select: { reference: true },
    });
    for (const p of awaiting) {
      if (p.reference) await reverifyAwaitingPayment(p.reference).catch((err) => console.error('M-Pesa re-verification failed:', err));
    }
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

    const mpesaCode = method === 'MOBILE_MONEY' ? normaliseMpesaCode(reference) : '';
    if (method === 'MOBILE_MONEY' && !MPESA_CODE.test(mpesaCode)) {
      return sendError(res, "Enter the 10-character M-Pesa code from the customer's confirmation message (e.g. SKL7H2X9QD), or send them a prompt instead.");
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock the order before reading its balance, so two cashiers (or a
      // cashier and an M-Pesa callback) can't both pay the same balance.
      if (!(await lockSale(tx, req.params.orderId))) throw new Error('ORDER_NOT_FOUND');
      const sale = await tx.sale.findFirst({
        where: { id: req.params.orderId, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
        include: { payments: { where: { status: 'COMPLETED' } } },
      });
      if (!sale) throw new Error('ORDER_NOT_FOUND');
      if (sale.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

      // A prompt still waiting on the customer's phone would pay this same balance.
      const inFlight = await tx.payment.findFirst({
        where: { saleId: sale.id, method: 'MOBILE_MONEY', status: 'PENDING', reference: { not: null }, createdAt: { gte: new Date(Date.now() - PROMPT_IN_FLIGHT_MS) } },
        select: { id: true },
      });
      if (inFlight) throw new PaymentInputError("An M-Pesa prompt for this bill is still on the customer's phone. Wait for it to finish (about a minute) before taking another payment.", 409);

      if (mpesaCode) {
        // Serialise checks of the same code (also taken by the prompt settlement), so it is never recorded twice.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mpesaReceiptLockKey(req.user!.restaurantId, mpesaCode)}))`;
        // Compare letters and digits only, so older entries typed with spaces or dashes still match.
        const used = await tx.$queryRaw<{ orderNumber: string }[]>`
          SELECT s."orderNumber" FROM "payments" p JOIN "orders" s ON s."id" = p."saleId"
          WHERE p."restaurantId" = ${req.user!.restaurantId} AND p."method" = 'MOBILE_MONEY'
            AND p."status" IN ('COMPLETED', 'REFUNDED', 'DUPLICATE')
            AND upper(regexp_replace(coalesce(p."reference", ''), '[^A-Za-z0-9]', '', 'g')) = ${mpesaCode}
          LIMIT 1`;
        if (used.length) throw new PaymentInputError(`M-Pesa code ${mpesaCode} was already used on order ${used[0].orderNumber}. Ask the customer for the right message.`, 409);
        // The same payment may be on its way from a prompt (confirmed, waiting for Safaricom's check).
        const confirming = await tx.payment.findFirst({
          where: { restaurantId: req.user!.restaurantId, method: 'MOBILE_MONEY', status: 'PENDING', notes: { contains: `receipt=${mpesaCode}` } },
          select: { id: true },
        });
        if (confirming) throw new PaymentInputError(`M-Pesa payment ${mpesaCode} came from a prompt and is being confirmed. It will show on the bill by itself shortly.`, 409);
      }

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
          reference: mpesaCode || reference?.trim() || null,
          notes: notes?.trim() || null,
          createdBy: req.user!.id,
        },
      });
      const state = await syncPaymentState(tx, sale.id);
      let receipt = null;
      if (state.paymentStatus === 'PAID') receipt = await ensureReceipt(tx, sale);
      return { payment, ...state, receipt, orderNumber: sale.orderNumber, saleId: sale.id, branchId: sale.branchId };
    });

    // Make sure the kitchen has the order: prepaid website orders are held back
    // until paid, and a ticket may have failed to create earlier. Idempotent.
    if (['SUBMITTED', 'PREPARING', 'READY'].includes(result.saleStatus)) {
      try {
        const existingTicket = await prisma.kitchenTicket.findFirst({ where: { orderId: result.saleId }, select: { id: true } });
        await createKitchenTicketForOrder(result.saleId, req.user!.restaurantId, result.branchId);
        if (!existingTicket) {
          realtimeService.broadcast(`kitchen:${result.branchId}`, 'ticket_created', { orderId: result.saleId, orderNumber: result.orderNumber, placedAt: new Date().toISOString() });
        }
      } catch (err) {
        console.error('Kitchen ticket creation after staff payment failed:', err);
      }
    }

    // An order already served and now fully paid is finished: close it
    // (frees the table, deducts stock if not done yet, awards loyalty).
    if (result.paymentStatus === 'PAID' && result.saleStatus === 'SERVED') {
      try {
        await completeOrder(result.saleId, req.user!.restaurantId, req.user!.id);
      } catch (err) {
        console.error('Auto-complete after full payment failed:', err);
      }
    }

    await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'Payment', result.payment.id, `Recorded ${method} payment of KES ${requested.toFixed(2)} for ${result.orderNumber}`);
    return sendResponse(res, true, 'Payment recorded', result, 201);
  } catch (e: any) {
    if (e instanceof PaymentInputError) return sendError(res, e.message, undefined, e.statusCode);
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
    const target = await prisma.payment.findFirst({
      where: { id: req.params.id, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
      select: { branchId: true },
    });
    if (!target) return sendError(res, 'Payment not found', undefined, 404);
    let approver;
    try {
      approver = await verifyApproval(req, 'refund a payment', { branchId: target.branchId });
    } catch (err) {
      if (sendApprovalError(res, err)) return;
      throw err;
    }
    const result = await prisma.$transaction(async (tx) => {
      const scope = { id: req.params.id, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) };
      const found = await tx.payment.findFirst({ where: scope, select: { saleId: true } });
      if (!found) throw new Error('PAYMENT_NOT_FOUND');
      // Same lock as payments, so two refunds of one payment can't both succeed.
      await lockSale(tx, found.saleId);
      const payment = await tx.payment.findFirst({ where: scope });
      if (!payment) throw new Error('PAYMENT_NOT_FOUND');
      // DUPLICATE: money that arrived for a bill already paid, kept so it can be refunded.
      if (payment.status !== 'COMPLETED' && payment.status !== 'DUPLICATE') throw new Error('PAYMENT_ALREADY_REFUNDED');
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', refundedAt: new Date(), refundReason: reason, refundedBy: req.user!.id, refundApprovedBy: approver.id } });
      const state = await syncPaymentState(tx, payment.saleId);
      return { paymentId: payment.id, ...state };
    });
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'REFUND', 'Payment', req.params.id, `Refunded payment, approved by ${approver.name}: ${reason}`);
    return sendResponse(res, true, 'Payment refunded', result);
  } catch (e: any) {
    if (e?.message === 'PAYMENT_NOT_FOUND') return sendError(res, 'Payment not found', undefined, 404);
    if (e?.message === 'PAYMENT_ALREADY_REFUNDED') return sendError(res, 'Payment has already been refunded');
    console.error(e); return sendError(res, 'Unable to refund payment.', undefined, 500);
  }
});

router.get('/orders/:orderId/receipt', authorize(...ORDER_PAYMENT_VIEW_ROLES), async (req: AuthRequest, res) => {
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
