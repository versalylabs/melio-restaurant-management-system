import crypto from 'crypto';
import { Request, Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendError, sendResponse } from '../utils/response';
import { createAuditLog } from './auditLogService';
import { confirmSimulatedMpesaPayment, getStaffMpesaStatus, initiateStaffMpesaPrompt } from './mpesaService';
import { isPaymentSimulationEnabled, PaymentError } from './onlinePaymentService';

/** A link stays valid for two days: long enough for a WhatsApp order, short enough not to linger. */
const LINK_LIFETIME_MS = 48 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Site address for the link: the staff member's own site when it is an allowed one, else the first configured. */
const frontendBase = (origin?: string) => {
  const allowed = (process.env.FRONTEND_URL || '').split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
  const o = (origin || '').replace(/\/$/, '');
  return allowed.includes(o) ? o : allowed[0] || '';
};

/**
 * Whose shift a link payment counts in: the staff member who sent the link if
 * their shift is still open, else whoever has a shift open at that branch now,
 * else the sender (it then shows on the Payments page, outside any shift).
 */
async function payingStaff(link: { createdBy: string; restaurantId: string; branchId: string }) {
  const own = await prisma.shift.findFirst({ where: { userId: link.createdBy, restaurantId: link.restaurantId, status: 'OPEN' }, select: { userId: true } });
  if (own) return own.userId;
  const open = await prisma.shift.findFirst({ where: { restaurantId: link.restaurantId, branchId: link.branchId, status: 'OPEN' }, orderBy: { openedAt: 'desc' }, select: { userId: true } });
  return open?.userId || link.createdBy;
}

/** Kenyan number → 2547… for a wa.me link; null when it isn't one. */
const waNumber = (raw?: string | null) => {
  let d = String(raw || '').replace(/[^0-9]/g, '');
  if (d.startsWith('0')) d = '254' + d.slice(1);
  return /^254[17]\d{8}$/.test(d) ? d : null;
};

/**
 * POST /payments/orders/:orderId/payment-link
 * Staff get a link to send the customer (on WhatsApp): it opens a page that
 * shows the bill and sends an M-Pesa prompt to the customer's phone. The
 * payment is recorded against the staff member who made the link, like a
 * prompt sent from the till.
 */
export async function createPaymentLink(req: AuthRequest, res: Response) {
  const sale = await prisma.sale.findFirst({
    where: { id: req.params.orderId, restaurantId: req.user!.restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
    include: { payments: { where: { status: 'COMPLETED' }, select: { amount: true } }, customer: { select: { phone: true } }, onlineOrder: { select: { contactPhone: true } }, restaurant: { select: { name: true } } },
  });
  if (!sale) return sendError(res, 'Order not found', undefined, 404);
  if (sale.status === 'CANCELLED') return sendError(res, 'This order was cancelled');
  const balance = round2(sale.totalAmount - sale.payments.reduce((t, p) => t + p.amount, 0));
  if (balance <= 0) return sendError(res, 'This bill is already paid');

  // Reuse a link that is still valid, so the customer never has two.
  let link = await prisma.paymentLink.findFirst({ where: { saleId: sale.id, expiresAt: { gt: new Date(Date.now() + 60 * 60 * 1000) } }, orderBy: { createdAt: 'desc' } });
  if (!link) {
    link = await prisma.paymentLink.create({
      data: {
        token: crypto.randomBytes(18).toString('base64url'),
        restaurantId: sale.restaurantId,
        branchId: sale.branchId,
        saleId: sale.id,
        createdBy: req.user!.id,
        expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
      },
    });
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'PaymentLink', sale.id, `Created a payment link for order ${sale.orderNumber}`);
  }

  const base = frontendBase(req.get('origin'));
  if (!base) return sendError(res, 'Payment links need the website address (FRONTEND_URL) to be set', undefined, 503);
  const url = `${base}/pay/${link.token}`;
  const message = `Hi, here is your bill from ${sale.restaurant.name} (order ${sale.orderNumber}, KES ${balance.toLocaleString()}). Pay by M-Pesa here: ${url}`;
  const phone = waNumber(req.body?.phone || sale.onlineOrder?.contactPhone || sale.customer?.phone);
  return sendResponse(res, true, 'Payment link ready', {
    url,
    expiresAt: link.expiresAt,
    message,
    whatsappUrl: `https://wa.me/${phone || ''}?text=${encodeURIComponent(message)}`,
    phoneKnown: !!phone,
  });
}

/** Finds a usable link; null when unknown or expired. */
async function findLink(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const link = await prisma.paymentLink.findUnique({ where: { token } });
  if (!link || link.expiresAt.getTime() < Date.now()) return null;
  return link;
}

/** GET /public/pay/:token — the bill, for the customer. Nothing private: no names, phones or staff. */
export async function getPublicPaymentLink(req: Request, res: Response) {
  const link = await findLink(req.params.token);
  if (!link) return sendError(res, 'This payment link has expired or is not valid. Ask the restaurant for a new one.', undefined, 404);
  const sale = await prisma.sale.findUnique({
    where: { id: link.saleId },
    include: {
      items: { select: { itemNameSnapshot: true, quantity: true, subtotal: true } },
      payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
      restaurant: { select: { name: true, logo: true } },
      branch: { select: { name: true } },
    },
  });
  if (!sale) return sendError(res, 'Order not found', undefined, 404);
  const paid = round2(sale.payments.reduce((t, p) => t + p.amount, 0));
  return sendResponse(res, true, 'Bill', {
    restaurantName: sale.restaurant.name,
    logo: sale.restaurant.logo,
    branchName: sale.branch.name,
    orderNumber: sale.orderNumber,
    items: sale.items,
    subtotal: sale.subtotal,
    discountAmount: sale.discountAmount,
    taxAmount: sale.taxAmount,
    taxInclusive: sale.taxInclusive,
    serviceChargeAmount: sale.serviceChargeAmount,
    totalAmount: sale.totalAmount,
    paid,
    balance: Math.max(0, round2(sale.totalAmount - paid)),
    cancelled: sale.status === 'CANCELLED',
    simulation: isPaymentSimulationEnabled(),
  });
}

/** POST /public/pay/:token/mpesa { phoneNumber } — sends the prompt for what is left to pay. */
export async function payPublicPaymentLink(req: Request, res: Response) {
  const link = await findLink(req.params.token);
  if (!link) return sendError(res, 'This payment link has expired or is not valid. Ask the restaurant for a new one.', undefined, 404);
  try {
    const userId = await payingStaff(link);
    const result = await initiateStaffMpesaPrompt({
      saleId: link.saleId,
      restaurantId: link.restaurantId,
      branchId: link.branchId,
      userId,
      phoneNumber: typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : '',
    });
    await createAuditLog(link.restaurantId, userId, 'CREATE', 'PaymentLink', link.saleId, `Customer started an M-Pesa payment of KES ${result.amount} from a payment link`);
    return sendResponse(res, true, `Check your phone ${result.phoneNumber} and enter your M-Pesa PIN.`, { checkoutRequestId: result.checkoutRequestId, amount: result.amount, simulated: result.simulated }, 201);
  } catch (err) {
    if (err instanceof PaymentError) return sendError(res, err.message, undefined, err.statusCode);
    console.error('Payment link prompt failed:', err);
    return sendError(res, "Couldn't reach M-Pesa. Try again in a moment.", undefined, 502);
  }
}

/** Status of a prompt sent from this link (and only this link's bill). */
async function linkPrompt(req: Request) {
  const link = await findLink(req.params.token);
  if (!link) return null;
  const status = await getStaffMpesaStatus(req.params.checkoutRequestId, link.restaurantId, link.branchId);
  if (!status || status.saleId !== link.saleId) return null;
  return status;
}

/** GET /public/pay/:token/status/:checkoutRequestId */
export async function getPublicPaymentLinkStatus(req: Request, res: Response) {
  const status = await linkPrompt(req);
  if (!status) return sendError(res, 'Payment not found', undefined, 404);
  return sendResponse(res, true, 'Payment status', { status: status.status, receipt: status.receipt, amount: status.amount, reason: status.reason });
}

/** Test mode only: pretend the customer entered their PIN. */
export async function simulatePublicPaymentLink(req: Request, res: Response) {
  if (!isPaymentSimulationEnabled()) return sendError(res, 'Only available in test mode', undefined, 403);
  const status = await linkPrompt(req);
  if (!status) return sendError(res, 'Payment not found', undefined, 404);
  try {
    await confirmSimulatedMpesaPayment(req.params.checkoutRequestId);
    return sendResponse(res, true, 'Simulated payment confirmed', {});
  } catch (err) {
    if (err instanceof PaymentError) return sendError(res, err.message, undefined, err.statusCode);
    throw err;
  }
}
