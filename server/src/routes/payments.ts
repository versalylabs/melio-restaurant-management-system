import { Router } from 'express';
import multer from 'multer';
import { checkStatement, parseStatement } from '../services/mpesaStatementService';
import { incomingTillPayments, registerTill, simulateTillPayment, SIMULATED_BILL_REF } from '../services/tillService';
import prisma from '../config/database';
import { etimsReceiptInfo, queueEtimsCredit, signPendingEtims, signSaleNow } from '../services/etimsService';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { createAuditLog } from '../services/auditLogService';
import { notifyRestaurantStaff } from '../services/notificationService';
import { createKitchenTicketForOrder } from '../services/kitchenService';
import { ensureReceipt, lockSale, syncPaymentState } from '../services/saleLedgerService';
import { completeOrder } from '../services/orderCompletionService';
import { confirmSimulatedMpesaPayment, getStaffMpesaStatus, initiateStaffMpesaPrompt, mpesaReceiptLockKey, PROMPT_IN_FLIGHT_MS, recheckStuckStaffPrompts, reverifyAwaitingPayment } from '../services/mpesaService';
import { isPaymentSimulationEnabled, PaymentError } from '../services/onlinePaymentService';
import { issueCreditNote } from '../services/taxService';
import { createPaymentLink } from '../services/paymentLinkService';
import { realtimeService } from '../services/realtimeService';
import { sendApprovalError, verifyApproval } from '../services/approvalService';
import { afterResponse, kenyanPhone, maskPhone } from '../services/smsService';

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

/** A payment link to send the customer on WhatsApp. */
router.post('/orders/:orderId/payment-link', authorize(...ORDER_PAYMENT_VIEW_ROLES), createPaymentLink);

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
    // M-Pesa is answering: settle any earlier prompts whose answer never came.
    afterResponse(recheckStuckStaffPrompts(req.user!.restaurantId));
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

/**
 * M-Pesa to check: payments taken while M-Pesa was down, and prompts whose
 * answer never came (asked again here first).
 */
/**
 * POST /payments/mpesa-statement (managers): upload the till's M-Pesa statement
 * (CSV) to check it against the payments in Melio. Confirms "M-Pesa to check"
 * payments it proves; lists money with nothing recorded, and codes recorded in
 * Melio that the statement doesn't have.
 */
const statementUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } }).single('statement');
router.post('/mpesa-statement', authorize('OWNER', 'ADMIN', 'MANAGER'), (req, res, next) => statementUpload(req, res, (err: any) => (err ? sendError(res, 'Upload the statement as a CSV file under 4 MB') : next())), async (req: AuthRequest, res) => {
  if (!req.file) return sendError(res, 'Choose the statement file');
  // A statement is one till's: compare it with that branch only.
  let branchId = req.user!.branchId;
  if (!branchId) {
    const branches = await prisma.branch.findMany({ where: { restaurantId: req.user!.restaurantId, status: 'ACTIVE' }, select: { id: true }, take: 2 });
    if (branches.length === 1) branchId = branches[0].id;
  }
  if (!branchId) return sendError(res, 'Choose the branch whose till statement this is (top bar), then upload it again');
  const buf = req.file.buffer;
  // Excel's "Unicode text" saves as UTF-16.
  const text = (buf[0] === 0xff && buf[1] === 0xfe) || buf.subarray(0, 200).includes(0) ? buf.toString('utf16le') : buf.toString('utf8');
  const parsed = parseStatement(text);
  if ('error' in parsed) return sendError(res, parsed.error);
  const result = await checkStatement(req.user!.restaurantId, branchId, parsed, req.user!.id);
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Payment', 'mpesa-statement', `Checked an M-Pesa statement: ${result.summary.lines} payments received, ${result.summary.matched} matched, ${result.summary.confirmedNow} confirmed, ${result.summary.notInMelio} not in Melio, ${result.summary.missingFromStatement} codes not on the statement`);
  return sendResponse(res, true, 'Statement checked', result);
});

/**
 * Branch whose till is meant: the top-bar branch (staff: their own), or the
 * branch picked in Settings. Staff tied to a branch may only pick their own.
 */
const tillBranch = async (req: AuthRequest, chosen?: unknown) => {
  let id = req.user!.branchId || '';
  if (typeof chosen === 'string' && chosen) {
    const own = (await prisma.user.findUnique({ where: { id: req.user!.id }, select: { branchId: true } }))?.branchId;
    if (own && own !== chosen) return null;
    id = chosen;
  }
  return id ? prisma.branch.findFirst({ where: { id, restaurantId: req.user!.restaurantId }, select: { id: true, restaurantId: true, mpesaShortcode: true, mpesaShortcodeType: true, mpesaRegisteredAt: true } }) : null;
};

/** Payments sent straight to this branch's till that aren't on a bill yet (the POS list). */
router.get('/incoming', authorize(...PAYMENT_ROLES), async (req: AuthRequest, res) => {
  const branch = await tillBranch(req);
  if (!branch?.mpesaShortcode || !branch.mpesaRegisteredAt) return sendResponse(res, true, 'No till connected', { enabled: false, payments: [] });
  return sendResponse(res, true, 'Incoming till payments', { enabled: true, payments: await incomingTillPayments(req.user!.restaurantId, branch.id) });
});

/** Ask Safaricom to send this branch's till payments to Melio. */
router.post('/till/register', authorize('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const branch = await tillBranch(req, req.body?.branchId);
  if (!branch) return sendError(res, 'Choose a branch');
  try {
    await registerTill(branch);
  } catch (err: any) {
    if (err?.message === 'NO_TILL') return sendError(res, 'Save the till or paybill number first');
    if (err?.message === 'NOT_CONFIGURED') return sendError(res, 'M-Pesa is not set up on the server (MPESA_CALLBACK_URL)', undefined, 503);
    if (err?.message === 'NO_IP_ALLOWLIST') return sendError(res, "Set MPESA_CALLBACK_ALLOWED_IPS to Safaricom's callback addresses before connecting a live till", undefined, 503);
    return sendError(res, `Safaricom refused: ${err?.message || 'unknown error'}`, undefined, 502);
  }
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Branch', branch.id, `Connected M-Pesa till ${branch.mpesaShortcode} to Melio`);
  return sendResponse(res, true, 'Till connected: its payments will now appear in Melio');
});

/** A test payment to the till (test mode, or the Daraja sandbox). */
router.post('/till/simulate', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  const branch = await tillBranch(req, req.body?.branchId);
  const amount = Number(req.body?.amount || 0);
  if (!branch) return sendError(res, 'Choose a branch');
  if (!(amount >= 1 && amount <= 150000)) return sendError(res, 'Enter an amount between 1 and 150,000');
  try {
    return sendResponse(res, true, 'Test payment sent', await simulateTillPayment(branch, amount));
  } catch (err: any) {
    if (err?.message === 'NO_TILL') return sendError(res, 'Save the till or paybill number first');
    if (err?.message === 'NOT_IN_PRODUCTION') return sendError(res, 'Test payments are only for the sandbox or test mode', undefined, 403);
    return sendError(res, `Safaricom refused: ${err?.message || 'unknown error'}`, undefined, 502);
  }
});

/**
 * POST /payments/mpesa-day-check { date }: the statement check, run on the
 * till payments Safaricom sent Melio for that day (no file needed).
 */
router.post('/mpesa-day-check', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  const branch = await tillBranch(req);
  if (!branch?.mpesaShortcode || !branch.mpesaRegisteredAt) return sendError(res, 'This branch has no till connected to Melio. Use a statement file instead.');
  const date = String(req.body?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendError(res, 'Choose a day');
  const since = branch.mpesaRegisteredAt.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  if (date < since) return sendError(res, `Melio has this till's payments from ${since} only. Use a statement file for earlier days.`);
  const start = new Date(`${date}T00:00:00+03:00`);
  const end = new Date(`${date}T23:59:59.999+03:00`);
  const day = 24 * 60 * 60 * 1000;
  // A day either side, so a code typed just after midnight still counts as received.
  const near = await prisma.mpesaTransaction.findMany({
    where: { restaurantId: req.user!.restaurantId, branchId: branch.id, transTime: { gte: new Date(start.getTime() - day), lte: new Date(end.getTime() + day) }, OR: [{ billRef: null }, { billRef: { not: SIMULATED_BILL_REF } }] },
    orderBy: { transTime: 'asc' },
  });
  const txns = near.filter((t) => t.transTime >= start && t.transTime <= end);
  if (!txns.length) return sendError(res, 'No till payments reached Melio that day');
  const lines = txns.map((t) => ({ receipt: t.transId, time: t.transTime, amount: t.amount, from: t.firstName || '' }));
  const result = await checkStatement(req.user!.restaurantId, branch.id, { lines, allReceipts: new Set(near.map((t) => t.transId)) }, req.user!.id);
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Payment', 'mpesa-day-check', `Checked M-Pesa till payments for ${date}: ${result.summary.lines} received, ${result.summary.matched} matched, ${result.summary.notInMelio} not on a bill, ${result.summary.missingFromStatement} codes not received`);
  return sendResponse(res, true, 'Day checked', result);
});

router.get('/mpesa-checks', authorize(...PAYMENT_ROLES), async (req: AuthRequest, res) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId || (typeof req.query.branchId === 'string' && req.query.branchId) || null;
  // Asking Safaricom again can be slow during an outage: never hold the list for it.
  const recheck = req.query.recheck === '1' ? await recheckStuckStaffPrompts(restaurantId, branchId) : null;
  if (!recheck) afterResponse(recheckStuckStaffPrompts(restaurantId, branchId));
  const scope = { restaurantId, ...(branchId ? { branchId } : {}) };
  const [toCheck, stuck] = await Promise.all([
    prisma.payment.findMany({
      where: { ...scope, verifyStatus: 'PENDING_CHECK', status: 'COMPLETED' },
      orderBy: { createdAt: 'asc' },
      include: { sale: { select: { id: true, orderNumber: true, totalAmount: true, status: true } } },
    }),
    prisma.payment.findMany({
      where: { ...scope, method: 'MOBILE_MONEY', status: 'PENDING', notes: { contains: '[STAFF_PROMPT]' }, createdAt: { lt: new Date(Date.now() - 2 * 60_000), gt: new Date(Date.now() - 48 * 60 * 60_000) } },
      orderBy: { createdAt: 'asc' },
      include: { sale: { select: { id: true, orderNumber: true, totalAmount: true, status: true } } },
    }),
  ]);
  const staffIds = [...new Set(toCheck.map((p) => p.createdBy))];
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds }, restaurantId }, select: { id: true, firstName: true } }) : [];
  const name = new Map(staff.map((u) => [u.id, u.firstName]));
  return sendResponse(res, true, 'M-Pesa to check', {
    recheck,
    toCheck: toCheck.map((p) => ({
      id: p.id, amount: p.amount, reference: p.reference, payerPhone: p.payerPhone ? maskPhone(p.payerPhone) : null,
      createdAt: p.createdAt, takenBy: name.get(p.createdBy) || null, takenById: p.createdBy, notes: p.notes?.replace('[M-Pesa to check]', '').replace(/\[approved by [^\]]+\]/, '').trim() || null, order: p.sale,
    })),
    stuckPrompts: stuck.map((p) => ({ id: p.id, amount: p.amount, createdAt: p.createdAt, order: p.sale })),
    totalToCheck: Math.round(toCheck.reduce((t, p) => t + p.amount, 0) * 100) / 100,
  });
});

/**
 * A manager checks a payment taken while M-Pesa was down against the till:
 * CONFIRMED (with its M-Pesa code) or NOT_RECEIVED (it comes off the bill,
 * which then shows what is still owed).
 */
router.post('/:id/check', authorize('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.roleName)) return sendError(res, 'Only a manager can check M-Pesa payments', undefined, 403);
  const result = String(req.body?.result || '');
  if (!['CONFIRMED', 'NOT_RECEIVED'].includes(result)) return sendError(res, 'Choose confirmed or not received');
  const restaurantId = req.user!.restaurantId;
  const found = await prisma.payment.findFirst({
    where: { id: req.params.id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}), verifyStatus: 'PENDING_CHECK' },
    select: { id: true, saleId: true, reference: true, createdBy: true, amount: true, branchId: true },
  });
  if (!found) return sendError(res, 'This payment is not waiting for a check', undefined, 404);
  if (found.createdBy === req.user!.id) return sendError(res, 'Someone other than the person who took this payment must check it', undefined, 403);
  const code = normaliseMpesaCode(req.body?.reference) || found.reference || '';
  if (result === 'CONFIRMED' && !MPESA_CODE.test(code)) return sendError(res, 'Enter the 10-character M-Pesa code you found on the till statement');
  try {
    const out = await prisma.$transaction(async (tx) => {
      // Same lock order as a prompt settling: the M-Pesa code first, then the order.
      if (result === 'CONFIRMED') await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mpesaReceiptLockKey(restaurantId, code)}))`;
      await lockSale(tx, found.saleId);
      const payment = await tx.payment.findUnique({ where: { id: found.id } });
      if (!payment || payment.verifyStatus !== 'PENDING_CHECK' || payment.status !== 'COMPLETED') throw new PaymentInputError('This payment was already checked, replaced or refunded', 409);
      if (result === 'CONFIRMED') {
        const used = await tx.$queryRaw<{ orderNumber: string }[]>`
          SELECT s."orderNumber" FROM "payments" p JOIN "orders" s ON s."id" = p."saleId"
          WHERE p."restaurantId" = ${restaurantId} AND p."method" = 'MOBILE_MONEY' AND p."id" <> ${payment.id}
            AND p."status" IN ('COMPLETED', 'REFUNDED', 'DUPLICATE')
            AND upper(regexp_replace(coalesce(p."reference", ''), '[^A-Za-z0-9]', '', 'g')) = ${code}
          LIMIT 1`;
        if (used.length) throw new PaymentInputError(`M-Pesa code ${code} was already used on order ${used[0].orderNumber}`, 409);
        await tx.payment.update({ where: { id: payment.id }, data: { reference: code, verifyStatus: 'CONFIRMED', verifiedBy: req.user!.id, verifiedAt: new Date() } });
        await tx.mpesaTransaction.updateMany({ where: { restaurantId, transId: code, paymentId: null }, data: { paymentId: payment.id } });
        return { message: `Confirmed: ${code}`, balance: null as number | null };
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'CANCELLED', verifyStatus: 'NOT_RECEIVED', verifiedBy: req.user!.id, verifiedAt: new Date(), notes: `${payment.notes || ''} [Not received when checked]`.trim() },
      });
      await tx.mpesaTransaction.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });
      const state = await syncPaymentState(tx, payment.saleId);
      const sale = await tx.sale.findUnique({ where: { id: payment.saleId }, select: { orderNumber: true } });
      return { message: `Order ${sale?.orderNumber} still owes KES ${state.balance.toLocaleString()}`, balance: state.balance };
    });
    await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Payment', found.id, result === 'CONFIRMED' ? `Checked an M-Pesa payment taken during an outage: received (${code})` : 'Checked an M-Pesa payment taken during an outage: NOT received; it was taken off the bill');
    if (result === 'NOT_RECEIVED') {
      notifyRestaurantStaff(restaurantId, found.branchId, 'MPESA_NOT_RECEIVED', 'M-Pesa payment not received', `KES ${found.amount.toLocaleString()} recorded as M-Pesa during an outage was not on the till statement. ${out.message}.`, 'Payment', found.id).catch(() => undefined);
    }
    return sendResponse(res, true, out.message, out);
  } catch (err: any) {
    if (err instanceof PaymentInputError) return sendError(res, err.message, undefined, err.statusCode);
    throw err;
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
    // M-Pesa is down (or the customer's message hasn't arrived): take the payment
    // now and let a manager check it against the till once M-Pesa is back.
    const checkLater = method === 'MOBILE_MONEY' && req.body?.checkLater === true;
    const payerPhone = checkLater && req.body?.payerPhone ? kenyanPhone(String(req.body.payerPhone)) : null;
    if (checkLater && req.body?.payerPhone && !payerPhone) return sendError(res, "Enter the customer's number like 0712 345 678, or leave it empty");
    // Marking a bill paid with money nobody has seen yet needs a manager's PIN.
    let laterApprover: { id: string } | null = null;
    if (checkLater) {
      const branchRow = await prisma.sale.findFirst({ where: { id: req.params.orderId, restaurantId: req.user!.restaurantId }, select: { branchId: true } });
      try {
        laterApprover = await verifyApproval(req, 'record an M-Pesa payment to check later', { branchId: branchRow?.branchId });
      } catch (err) {
        if (sendApprovalError(res, err)) return;
        throw err;
      }
    }
    if (!METHODS.includes(method)) return sendError(res, 'Invalid payment method');
    const requested = Number(amount);
    if (!Number.isFinite(requested) || requested <= 0) return sendError(res, 'Payment amount must be greater than zero');

    let tendered = amountTendered == null ? requested : Number(amountTendered);
    if (!Number.isFinite(tendered) || tendered < requested) return sendError(res, 'Amount tendered must be at least the payment amount');
    const change = method === 'CASH' ? tendered - requested : 0;

    const mpesaCode = method === 'MOBILE_MONEY' ? normaliseMpesaCode(reference) : '';
    if (method === 'MOBILE_MONEY' && !(checkLater && !mpesaCode) && !MPESA_CODE.test(mpesaCode)) {
      return sendError(res, "Enter the 10-character M-Pesa code from the customer's confirmation message (e.g. SKL7H2X9QD), or send them a prompt instead.");
    }

    let till: { id: string; amount: number } | null = null;
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
        // Safaricom already told Melio about this code: it can't pay more than was sent.
        till = await tx.mpesaTransaction.findFirst({ where: { restaurantId: req.user!.restaurantId, transId: mpesaCode }, select: { id: true, amount: true } });
        if (till && requested > till.amount + 1) throw new PaymentInputError(`M-Pesa payment ${mpesaCode} was KES ${till.amount.toLocaleString()}, less than the KES ${requested.toLocaleString()} entered`, 400);
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
          reference: mpesaCode || (method === 'MOBILE_MONEY' ? null : reference?.trim() || null),
          notes: (checkLater ? `[M-Pesa to check] ${notes?.trim() || ''}`.trim() : notes?.trim()) || null,
          createdBy: req.user!.id,
          ...(checkLater ? { verifyStatus: till ? 'CONFIRMED' : 'PENDING_CHECK', ...(till ? { verifiedAt: new Date() } : {}), payerPhone, refundApprovedBy: null, notes: `[M-Pesa to check]${laterApprover ? ` [approved by ${laterApprover.id}]` : ''} ${notes?.trim() || ''}`.trim() } : {}),
          // The customer sent more than this bill: keep a note so the excess is refunded or used.
          ...(till && till.amount > requested + 1 ? { notes: `${notes?.trim() || ''} [Till payment KES ${till.amount}; KES ${Math.round((till.amount - requested) * 100) / 100} more than this bill]`.trim() } : {}),
        },
      });
      if (till) await tx.mpesaTransaction.update({ where: { id: till.id }, data: { paymentId: payment.id } });
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

    realtimeService.broadcast(`orders:${result.branchId}`, 'order_paid', { orderId: result.saleId, paymentStatus: result.paymentStatus });
    if (checkLater) {
      notifyRestaurantStaff(req.user!.restaurantId, result.branchId, 'MPESA_TO_CHECK', 'M-Pesa to check', `KES ${requested.toLocaleString()} for order ${result.orderNumber} was recorded while M-Pesa was down. Check it against the till once M-Pesa is back.`, 'Payment', result.payment.id).catch(() => undefined);
    }
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'Payment', result.payment.id, `Recorded ${method} payment of KES ${requested.toFixed(2)} for ${result.orderNumber}`);
    // A bill just paid in full has a receipt waiting for KRA (when eTIMS is set up).
    if (result.receipt) afterResponse(signPendingEtims(req.user!.restaurantId, result.branchId, 3));
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
      select: { branchId: true, verifyStatus: true },
    });
    if (!target) return sendError(res, 'Payment not found', undefined, 404);
    if (target.verifyStatus === 'PENDING_CHECK') return sendError(res, 'This M-Pesa payment has not been checked yet. Check it against the till first (Payments, M-Pesa to check).', undefined, 409);
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
      // A refund of money counted in a closed sale reverses that sale for VAT and the levy:
      // it gets a credit note. Money that was never part of the sale (paid twice) does not.
      const sale = await tx.sale.findUnique({ where: { id: payment.saleId }, select: { status: true } });
      const creditNote = payment.status === 'COMPLETED' && sale?.status === 'COMPLETED'
        ? await issueCreditNote(tx, { restaurantId: payment.restaurantId, branchId: payment.branchId, saleId: payment.saleId, paymentId: payment.id, amount: payment.amount, reason, createdBy: req.user!.id })
        : null;
      // Refunded before the bill was closed, but the bill already went to KRA: KRA still needs a credit note.
      if (!creditNote && payment.status === 'COMPLETED') {
        await queueEtimsCredit(tx, { restaurantId: payment.restaurantId, branchId: payment.branchId, saleId: payment.saleId, amount: payment.amount, key: `P:${payment.id}` });
      }
      const state = await syncPaymentState(tx, payment.saleId);
      return { paymentId: payment.id, creditNote: creditNote ? { number: creditNote.number, amount: creditNote.amount, vatAmount: creditNote.vatAmount } : null, ...state };
    });
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'REFUND', 'Payment', req.params.id, `Refunded payment, approved by ${approver.name}: ${reason}`);
    afterResponse(signPendingEtims(req.user!.restaurantId, null, 3));
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
      // A bill that was paid and then refunded (with a credit note) can still be printed.
      const credited = (await tx.creditNote.aggregate({ where: { saleId: sale.id }, _sum: { amount: true } }))._sum.amount || 0;
      if (paid + credited + 0.005 < sale.totalAmount) throw new Error('ORDER_NOT_PAID');
      const receipt = sale.receipt || await ensureReceipt(tx, sale);
      const updatedReceipt = await tx.receipt.update({ where: { id: receipt.id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
      const business = await tx.restaurant.findUnique({
        where: { id: sale.restaurantId },
        select: { name: true, legalName: true, kraPin: true, vatRegistered: true, taxRate: true },
      });
      const creditNotes = await tx.creditNote.findMany({ where: { saleId: sale.id }, select: { number: true, amount: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
      // What a receipt may say about tax. KRA eTIMS details are added separately once KRA has signed it.
      const tax = {
        businessName: business?.legalName || business?.name,
        kraPin: business?.kraPin || null,
        vatRegistered: !!business?.vatRegistered,
        // The rate this bill was charged at, not today's setting.
        vatRate: sale.taxableAmount > 0 ? Math.round((sale.taxAmount / sale.taxableAmount) * 10000) / 10000 : business ? (business.taxRate > 1 ? business.taxRate / 100 : business.taxRate) : 0,
        taxInclusive: sale.taxInclusive,
        vatAmount: sale.taxAmount,
      };
      return { sale, receipt: updatedReceipt, tax, creditNotes };
    });
    // A receipt being printed gets KRA's signature first, if it is still waiting (short wait).
    await signSaleNow(result.sale.id);
    return sendResponse(res, true, 'Receipt retrieved', { ...result, etims: await etimsReceiptInfo(result.sale.id) });
  } catch (e: any) {
    if (e?.message === 'ORDER_NOT_FOUND') return sendError(res, 'Order not found', undefined, 404);
    if (e?.message === 'ORDER_NOT_PAID') return sendError(res, 'A receipt is available only after the order is fully paid');
    console.error(e); return sendError(res, 'Unable to load receipt.', undefined, 500);
  }
});

export default router;
