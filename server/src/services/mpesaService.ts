import crypto from 'crypto';
import prisma from '../config/database';
import { realtimeService } from './realtimeService';
import { isPaymentSimulationEnabled, PaymentError, settleOnlinePayment } from './onlinePaymentService';
import { ensureReceipt, lockSale, syncPaymentState } from './saleLedgerService';
import { notifyRestaurantStaff } from './notificationService';
import { createKitchenTicketForOrder } from './kitchenService';
import { completeOrder } from './orderCompletionService';
import { signPendingEtims } from './etimsService';
import { afterResponse } from './smsService';

/*
 * M-Pesa (Safaricom Daraja) STK Push.
 *
 * State lives in the `payments` table, not in memory, so it works on
 * serverless hosts (Vercel) where each request may hit a different instance:
 *   - initiation creates/updates a PENDING payment whose `reference` is the CheckoutRequestID
 *   - only Safaricom's callback (authenticated with MPESA_CALLBACK_SECRET and
 *     re-verified with the STK query API) can complete it
 *
 * Required env for live payments:
 *   MPESA_ENVIRONMENT=sandbox|production, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET,
 *   MPESA_PASSKEY, MPESA_SHORTCODE, MPESA_CALLBACK_SECRET,
 *   MPESA_CALLBACK_URL=https://<your-domain>/api/public/payments/mpesa/callback
 * Optional: MPESA_TRANSACTION_TYPE (default CustomerPayBillOnline; use
 *   CustomerBuyGoodsOnline for till numbers), MPESA_PARTY_B (till number when it
 *   differs from the shortcode).
 */

const CHECKOUT_TAG = (id: string) => `[CheckoutRequestID: ${id}]`;

function config() {
  const env = process.env.MPESA_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const shortcode = process.env.MPESA_SHORTCODE || '';
  return {
    baseUrl: env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    passkey: process.env.MPESA_PASSKEY || '',
    shortcode,
    partyB: process.env.MPESA_PARTY_B || shortcode,
    transactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    callbackUrl: process.env.MPESA_CALLBACK_URL || '',
    callbackSecret: process.env.MPESA_CALLBACK_SECRET || '',
  };
}

/** sandbox or production, and the public address Safaricom calls back (from MPESA_CALLBACK_URL). */
export const mpesaEnvironment = () => config().baseUrl.includes('sandbox') ? 'sandbox' : 'production';
export const mpesaCallbackBase = () => {
  try { return new URL(config().callbackUrl).origin; } catch { return ''; }
};
export const mpesaCallbackSecret = () => config().callbackSecret;

export function isMpesaConfigured(): boolean {
  const c = config();
  return Boolean(c.consumerKey && c.consumerSecret && c.passkey && c.shortcode && c.callbackUrl && c.callbackSecret.length >= 16);
}

function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  else if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = '254' + cleaned;
  return cleaned;
}

const maskPhone = (p: string) => (p.length > 7 ? `${p.slice(0, 6)}***${p.slice(-3)}` : '***');

/** Daraja expects the timestamp in Kenyan time (EAT, UTC+3) as YYYYMMDDHHmmss. */
function darajaTimestamp(): string {
  const eat = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const c = config();
  const basic = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString('base64');
  const res = await fetch(`${c.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new PaymentError('MPESA_AUTH_FAILED', 'Could not reach M-Pesa. Please try again shortly.', 502);
  const body = (await res.json()) as { access_token: string; expires_in: string | number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3599) * 1000 };
  return body.access_token;
}

export async function darajaPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${config().baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
  if (!res.ok) {
    throw new PaymentError('MPESA_REQUEST_FAILED', body?.errorMessage || `M-Pesa request failed (${res.status})`, 502);
  }
  return body;
}

function stkPassword(timestamp: string) {
  const c = config();
  return Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString('base64');
}

/**
 * Sends the STK request (or makes a simulated one). Daraja only accepts whole
 * shillings, so the charge is rounded up.
 */
async function requestStkPush(formattedPhone: string, amount: number, orderNumber: string) {
  const chargeAmount = Math.ceil(amount);
  if (!isMpesaConfigured()) {
    return {
      checkoutRequestId: `SIM_ws_CO_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
      merchantRequestId: `SIM_MR_${crypto.randomBytes(4).toString('hex')}`,
      chargeAmount,
    };
  }
  const c = config();
  const callback = new URL(c.callbackUrl);
  callback.searchParams.set('token', c.callbackSecret);
  const timestamp = darajaTimestamp();
  const response = await darajaPost<{ ResponseCode: string; ResponseDescription: string; CheckoutRequestID: string; MerchantRequestID: string; CustomerMessage?: string }>(
    '/mpesa/stkpush/v1/processrequest',
    {
      BusinessShortCode: c.shortcode,
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      TransactionType: c.transactionType,
      Amount: chargeAmount,
      PartyA: formattedPhone,
      PartyB: c.partyB,
      PhoneNumber: formattedPhone,
      CallBackURL: callback.toString(),
      AccountReference: orderNumber.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'MELIO',
      TransactionDesc: 'Melio order',
    },
  );
  if (String(response.ResponseCode) !== '0') {
    throw new PaymentError('MPESA_REJECTED', response.ResponseDescription || 'M-Pesa could not start the payment', 502);
  }
  return { checkoutRequestId: response.CheckoutRequestID, merchantRequestId: response.MerchantRequestID, chargeAmount };
}

/** A prompt sent this recently may still be on the customer's phone. */
export const PROMPT_IN_FLIGHT_MS = 90_000;
/** Marks prompts sent from staff screens (as opposed to the website checkout). */
const STAFF_PROMPT_TAG = '[STAFF_PROMPT]';
export const isStaffPrompt = (notes?: string | null) => !!notes && notes.includes(STAFF_PROMPT_TAG);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Same key the manual code check uses, so a receipt is never recorded twice. */
export const mpesaReceiptLockKey = (restaurantId: string, code: string) => `${restaurantId}:mpesa:${code}`;

/**
 * Staff send an M-Pesa prompt to a customer's phone for any bill (a table, a
 * takeaway, part of a split bill). The payment is recorded against the staff
 * member who sent it, so it counts toward their shift's expected M-Pesa, and
 * it only becomes COMPLETED when Safaricom confirms it.
 *
 * The PENDING row is created under the order lock before Daraja is called, so
 * two taps can't send two prompts, and a prompt Daraja accepted always has a
 * row for its callback to find.
 */
export async function initiateStaffMpesaPrompt(params: {
  saleId: string;
  restaurantId: string;
  branchId?: string | null;
  userId: string;
  phoneNumber: string;
  amount?: number;
}) {
  const simulated = !isMpesaConfigured();
  if (simulated && !isPaymentSimulationEnabled()) {
    throw new PaymentError('MPESA_NOT_CONFIGURED', "M-Pesa prompts aren't set up yet. Ask the owner to connect the till, or take the M-Pesa code instead.", 503);
  }
  const formattedPhone = formatPhoneNumber(params.phoneNumber || '');
  if (!/^254(7|1)\d{8}$/.test(formattedPhone)) {
    throw new PaymentError('INVALID_PHONE_NUMBER', "Enter the customer's Safaricom number, e.g. 0712 345 678.");
  }

  const placeholderRef = `PROMPT_${crypto.randomBytes(8).toString('hex')}`;
  const { sale, amount, paymentId } = await prisma.$transaction(async (tx) => {
    if (!(await lockSale(tx, params.saleId))) throw new PaymentError('ORDER_NOT_FOUND', 'Order not found', 404);
    const found = await tx.sale.findFirst({
      where: { id: params.saleId, restaurantId: params.restaurantId, ...(params.branchId ? { branchId: params.branchId } : {}) },
      include: { payments: { where: { OR: [{ status: 'COMPLETED' }, { status: 'PENDING', method: 'MOBILE_MONEY', reference: { not: null } }] } } },
    });
    if (!found) throw new PaymentError('ORDER_NOT_FOUND', 'Order not found', 404);
    if (found.status === 'CANCELLED') throw new PaymentError('ORDER_CANCELLED', 'This order was cancelled');
    const recent = found.payments.find((p) => p.status === 'PENDING' && Date.now() - p.createdAt.getTime() < PROMPT_IN_FLIGHT_MS);
    if (recent) {
      throw new PaymentError('MPESA_IN_FLIGHT', 'A prompt was sent for this bill less than 90 seconds ago. Wait for the customer to finish, or try again shortly.', 409);
    }

    const paid = found.payments.filter((p) => p.status === 'COMPLETED').reduce((sum, p) => sum + p.amount, 0);
    const balance = round2(Math.max(0, found.totalAmount - paid));
    if (balance <= 0) throw new PaymentError('ORDER_ALREADY_PAID', 'This bill is already paid');
    // Daraja charges whole shillings: up to the balance rounded up is accepted, and
    // what is recorded never exceeds the balance.
    const requested = params.amount === undefined || params.amount === null ? balance : Number(params.amount);
    if (!Number.isFinite(requested) || requested <= 0) throw new PaymentError('INVALID_AMOUNT', 'Enter an amount to charge');
    if (requested > Math.ceil(balance) + 0.005) throw new PaymentError('INVALID_AMOUNT', `The bill only has KES ${balance.toLocaleString()} left to pay`);
    const recorded = round2(Math.min(requested, balance));
    if (recorded < 1 && recorded !== balance) throw new PaymentError('INVALID_AMOUNT', 'The amount must be at least KES 1');

    const row = await tx.payment.create({
      data: {
        restaurantId: found.restaurantId,
        branchId: found.branchId,
        saleId: found.id,
        method: 'MOBILE_MONEY',
        amount: recorded,
        status: 'PENDING',
        reference: placeholderRef,
        notes: `M-Pesa prompt to ${maskPhone(formattedPhone)} ${STAFF_PROMPT_TAG}${simulated ? ' [SIMULATED]' : ''}`,
        createdBy: params.userId,
      },
    });
    return { sale: found, amount: recorded, paymentId: row.id };
  });

  let checkoutRequestId: string;
  let chargeAmount: number;
  try {
    ({ checkoutRequestId, chargeAmount } = await requestStkPush(formattedPhone, amount, sale.orderNumber));
  } catch (err) {
    // Daraja refused or was unreachable: nothing reached the phone.
    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'FAILED', notes: `M-Pesa prompt to ${maskPhone(formattedPhone)} ${STAFF_PROMPT_TAG} [Failed: could not reach M-Pesa]` } });
    throw err;
  }
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      reference: checkoutRequestId,
      notes: `M-Pesa prompt to ${maskPhone(formattedPhone)} ${STAFF_PROMPT_TAG} ${CHECKOUT_TAG(checkoutRequestId)}${simulated ? ' [SIMULATED]' : ''}`,
    },
  });
  return { checkoutRequestId, simulated, phoneNumber: maskPhone(formattedPhone), amount: chargeAmount, orderNumber: sale.orderNumber };
}

/**
 * Completes a staff-sent prompt once Safaricom has confirmed it.
 * - A receipt already recorded (e.g. the cashier typed the code from the
 *   customer's SMS before the confirmation arrived) is never counted twice.
 * - Money for a bill that is already paid or cancelled, or more than what was
 *   left to pay, is kept on record and flagged for a refund.
 * `receipt` is null when Safaricom confirmed the request but the callback with
 * the receipt number never arrived; the receipt is filled in if it comes later.
 */
/** Exported for tests; production callers are the callback, simulate and status re-check. */
export async function settleStaffStkPayment(paymentId: string, checkoutRequestId: string, receipt: string | null, paidAmount: number) {
  const result = await prisma.$transaction(async (tx) => {
    const pending = await tx.payment.findUnique({ where: { id: paymentId }, select: { saleId: true, restaurantId: true } });
    if (!pending) return null;
    if (receipt) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mpesaReceiptLockKey(pending.restaurantId, receipt)}))`;
    await lockSale(tx, pending.saleId);
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return null;

    // Confirmed earlier without a receipt number: just record the receipt now.
    if (payment.status !== 'PENDING') {
      if (receipt && payment.status === 'COMPLETED' && payment.reference === `STK_${checkoutRequestId}`) {
        await tx.payment.update({ where: { id: payment.id }, data: { reference: receipt, notes: `${payment.notes || ''} [Receipt ${receipt}]`.trim() } });
        await tx.mpesaTransaction.updateMany({ where: { restaurantId: payment.restaurantId, transId: receipt, paymentId: null }, data: { paymentId: payment.id } });
      }
      return null;
    }

    if (receipt) {
      const existing = await tx.payment.findFirst({
        where: { restaurantId: payment.restaurantId, method: 'MOBILE_MONEY', id: { not: payment.id }, status: { in: ['COMPLETED', 'REFUNDED', 'DUPLICATE'] }, reference: { equals: receipt, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'CANCELLED', notes: `${payment.notes || ''} [Receipt ${receipt} was already recorded by hand]`.trim() },
        });
        return { duplicateOfManual: true as const };
      }
    }

    let sale = await tx.sale.findUnique({ where: { id: payment.saleId }, include: { payments: { where: { status: 'COMPLETED' } } } });
    if (!sale) return null;
    // The bill was marked paid "M-Pesa to check" while this prompt's answer was
    // missing: this is that money. Replace the unchecked entry with the real one.
    if (round2(sale.totalAmount - sale.payments.reduce((sum, p) => sum + p.amount, 0)) <= 0.005) {
      const unchecked = sale.payments.find((p) => p.verifyStatus === 'PENDING_CHECK' && p.method === 'MOBILE_MONEY' && Math.abs(p.amount - paidAmount) <= 1);
      if (unchecked) {
        await tx.payment.update({ where: { id: unchecked.id }, data: { status: 'CANCELLED', verifyStatus: 'SUPERSEDED', verifiedAt: new Date(), notes: `${unchecked.notes || ''} [Replaced by the M-Pesa prompt payment ${receipt || checkoutRequestId}]`.trim() } });
        sale = await tx.sale.findUnique({ where: { id: payment.saleId }, include: { payments: { where: { status: 'COMPLETED' } } } });
        if (!sale) return null;
      }
    }
    const balance = round2(sale.totalAmount - sale.payments.reduce((sum, p) => sum + p.amount, 0));
    const reference = receipt || `STK_${checkoutRequestId}`;
    const tag = CHECKOUT_TAG(checkoutRequestId);

    let refundReason: string | null = null;
    let excess = 0;
    if (sale.status === 'CANCELLED') refundReason = 'ORDER CANCELLED';
    else if (balance <= 0.005) refundReason = 'BILL ALREADY PAID';
    // Daraja rounds up to whole shillings, so up to KES 1 over is expected change, not an overpayment.
    else if (paidAmount > balance + 1) excess = round2(paidAmount - balance);

    if (refundReason === 'BILL ALREADY PAID') {
      // Kept apart from the bill (not counted as paid) until it is refunded.
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'DUPLICATE', amount: paidAmount, reference, notes: `M-Pesa receipt ${reference} ${STAFF_PROMPT_TAG} ${tag} [BILL ALREADY PAID - REFUND REQUIRED]` } });
    } else {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          amount: paidAmount,
          reference,
          notes: `M-Pesa receipt ${reference} ${STAFF_PROMPT_TAG} ${tag}${refundReason ? ` [${refundReason} - REFUND REQUIRED]` : ''}${excess ? ` [OVERPAID BY ${excess} - REFUND THE EXCESS]` : ''}`,
        },
      });
    }
    // A till notification for this receipt may have arrived first: it is this payment.
    if (receipt) await tx.mpesaTransaction.updateMany({ where: { restaurantId: payment.restaurantId, transId: receipt, paymentId: null }, data: { paymentId: payment.id } });
    const state = await syncPaymentState(tx, sale.id);
    if (state.paymentStatus === 'PAID' && !refundReason) await ensureReceipt(tx, sale);
    return { duplicateOfManual: false as const, sale, state, refundReason, excess, reference };
  });
  if (!result) return { handled: true, status: 'ALREADY_SETTLED' };
  if (result.duplicateOfManual) return { handled: true, status: 'ALREADY_RECORDED' };

  const { sale, state, refundReason, excess, reference } = result;
  // A bill paid by prompt may have a receipt waiting for KRA (no staff screen triggers it).
  if (state.paymentStatus === 'PAID') afterResponse(signPendingEtims(sale.restaurantId, sale.branchId, 3));
  if (refundReason || excess) {
    const what = refundReason === 'ORDER CANCELLED' ? 'which was cancelled' : refundReason ? 'which was already paid' : `which only had KES ${round2(paidAmount - excess)} left to pay`;
    void notifyRestaurantStaff(sale.restaurantId, sale.branchId, 'REFUND_REQUIRED', 'Refund required',
      `An M-Pesa payment of KES ${paidAmount} (${reference}) arrived for order ${sale.orderNumber}, ${what}. Refund the customer KES ${excess || paidAmount}.`,
      'SALE', sale.id).catch((err) => console.error('Refund-required notification failed:', err));
  }
  if (!refundReason) {
    if (['SUBMITTED', 'PREPARING', 'READY'].includes(state.saleStatus)) {
      try {
        const hadTicket = await prisma.kitchenTicket.findFirst({ where: { orderId: sale.id }, select: { id: true } });
        await createKitchenTicketForOrder(sale.id, sale.restaurantId, sale.branchId);
        if (!hadTicket) {
          realtimeService.broadcast(`kitchen:${sale.branchId}`, 'ticket_created', { orderId: sale.id, orderNumber: sale.orderNumber, placedAt: new Date().toISOString() });
        }
      } catch (err) {
        console.error('[M-Pesa] Kitchen ticket check after staff prompt payment failed:', err);
      }
    }
    if (state.paymentStatus === 'PAID' && state.saleStatus === 'SERVED') {
      try {
        await completeOrder(sale.id, sale.restaurantId, sale.createdBy);
      } catch (err) {
        console.error('[M-Pesa] Auto-complete after staff prompt payment failed:', err);
      }
    }
    realtimeService.broadcast(`orders:${sale.branchId}`, 'order_paid', {
      saleId: sale.id,
      orderNumber: sale.orderNumber,
      amount: paidAmount,
      method: 'M-Pesa',
      receiptNumber: reference,
      checkoutRequestId,
    });
  }
  return { handled: true, status: refundReason || excess ? 'REFUND_REQUIRED' : 'PAID' };
}

export async function initiateMpesaStkPush({ trackingToken, phoneNumber }: { trackingToken: string; phoneNumber: string; amount?: number }) {
  const simulated = !isMpesaConfigured();
  if (simulated && !isPaymentSimulationEnabled()) {
    throw new PaymentError('MPESA_NOT_CONFIGURED', 'M-Pesa payments are not available right now. Please choose pay on pickup or contact the restaurant.', 503);
  }

  const online = await prisma.onlineOrder.findUnique({ where: { trackingToken }, include: { sale: true } });
  if (!online) throw new PaymentError('ORDER_NOT_FOUND', 'Order not found', 404);
  if (online.paymentState === 'PAID') throw new PaymentError('ORDER_ALREADY_PAID', 'This order has already been paid');
  if (online.sale.status === 'CANCELLED') throw new PaymentError('ORDER_CANCELLED', 'This order was cancelled');

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!/^254(7|1)\d{8}$/.test(formattedPhone)) {
    throw new PaymentError('INVALID_PHONE_NUMBER', 'Please enter a valid Kenyan Safaricom phone number (e.g. 0712345678).');
  }

  const payableAmount = Math.max(0, online.sale.totalAmount - online.sale.amountPaid);
  if (payableAmount <= 0) throw new PaymentError('ORDER_ALREADY_PAID', 'This order has already been paid');
  const { checkoutRequestId, merchantRequestId, chargeAmount } = await requestStkPush(formattedPhone, payableAmount, online.sale.orderNumber);

  const notes = `M-Pesa STK push to ${maskPhone(formattedPhone)} ${CHECKOUT_TAG(checkoutRequestId)}${simulated ? ' [SIMULATED]' : ''}`;

  // Reuse the placeholder pending payment created at checkout if it has not
  // been tied to an STK request yet; otherwise record a new attempt.
  const placeholder = await prisma.payment.findFirst({
    where: { saleId: online.saleId, status: 'PENDING', reference: null },
    orderBy: { createdAt: 'desc' },
  });
  if (placeholder) {
    await prisma.payment.update({
      where: { id: placeholder.id },
      data: { method: 'MOBILE_MONEY', amount: payableAmount, reference: checkoutRequestId, notes, createdAt: new Date() },
    });
  } else {
    await prisma.payment.create({
      data: {
        restaurantId: online.restaurantId,
        branchId: online.branchId,
        saleId: online.saleId,
        method: 'MOBILE_MONEY',
        amount: payableAmount,
        status: 'PENDING',
        reference: checkoutRequestId,
        notes,
        createdBy: online.sale.createdBy,
      },
    });
  }

  return {
    success: true,
    simulated,
    message: `STK Push prompt sent to ${formattedPhone}. Please enter your M-Pesa PIN on your phone to complete payment.`,
    checkoutRequestId,
    merchantRequestId,
    phoneNumber: formattedPhone,
    amount: chargeAmount,
  };
}

async function findPendingStkPayment(checkoutRequestId: string) {
  return prisma.payment.findFirst({
    where: { reference: checkoutRequestId, status: 'PENDING', method: 'MOBILE_MONEY' },
    include: { sale: { include: { onlineOrder: true } } },
  });
}

export function verifyCallbackToken(token: unknown): boolean {
  const secret = config().callbackSecret;
  if (!secret || typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Ask Safaricom directly whether the STK request succeeded (defence in depth on top of the callback secret). */
/** Daraja result codes that mean the payment did not happen (wrong PIN, cancelled, timed out, low balance…). */
const STK_DEFINITE_FAILURES = new Set(['1', '1001', '1019', '1025', '1032', '1037', '2001', '2006', '2028', '2029']);

async function queryStkResult(checkoutRequestId: string): Promise<'SUCCESS' | 'FAILED' | 'UNKNOWN'> {
  try {
    const c = config();
    const timestamp = darajaTimestamp();
    const result = await darajaPost<{ ResultCode?: string | number }>('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: c.shortcode,
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    });
    if (result.ResultCode === undefined) return 'UNKNOWN';
    const code = String(result.ResultCode);
    if (code === '0') return 'SUCCESS';
    // Only answers that mean the customer did not pay. Anything else (still
    // processing, system busy during an outage) is asked again later.
    return STK_DEFINITE_FAILURES.has(code) ? 'FAILED' : 'UNKNOWN';
  } catch (err) {
    console.warn('[M-Pesa] STK status query failed; relying on authenticated callback:', err);
    return 'UNKNOWN';
  }
}

interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: Array<{ Name: string; Value?: string | number }> };
    };
  };
}

/** Handles Safaricom's STK callback. Always resolves; the route acknowledges Safaricom regardless. */
export async function handleMpesaCallback(body: StkCallbackBody, token: unknown): Promise<{ handled: boolean; status?: string; reason?: string }> {
  if (!verifyCallbackToken(token)) throw new PaymentError('UNAUTHORIZED', 'Invalid callback token', 401);

  const cb = body?.Body?.stkCallback;
  const checkoutRequestId = cb?.CheckoutRequestID ? String(cb.CheckoutRequestID) : '';
  if (!checkoutRequestId) return { handled: false, reason: 'missing CheckoutRequestID' };

  const payment = await findPendingStkPayment(checkoutRequestId);
  if (!payment) {
    // Settled earlier from Safaricom's status query, before this callback: record the receipt number.
    const late = String(cb?.ResultCode) === '0' ? String(cb?.CallbackMetadata?.Item?.find((i) => i.Name === 'MpesaReceiptNumber')?.Value || '') : '';
    if (late) {
      const confirmed = await prisma.payment.findFirst({ where: { reference: `STK_${checkoutRequestId}`, status: 'COMPLETED' }, select: { id: true } });
      if (confirmed) {
        await settleStaffStkPayment(confirmed.id, checkoutRequestId, late, 0);
        return { handled: true, status: 'RECEIPT_RECORDED' };
      }
    }
    return { handled: false, reason: 'no pending payment for this request' };
  }
  // Prompts staff sent from the till settle as till payments, even on a website order.
  const online = isStaffPrompt(payment.notes) ? null : payment.sale.onlineOrder;

  if (String(cb?.ResultCode) !== '0') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', notes: `${payment.notes || ''} [Failed: ${cb?.ResultDesc || 'cancelled'}]`.trim() },
    });
    if (online) {
      realtimeService.broadcast(`order-tracking:${online.trackingToken}`, 'payment_failed', {
        trackingToken: online.trackingToken,
        method: 'M-Pesa',
        reason: cb?.ResultDesc || 'Payment was not completed',
      });
    }
    realtimeService.broadcast(`orders:${payment.branchId}`, 'mpesa_failed', {
      saleId: payment.saleId,
      checkoutRequestId,
      reason: cb?.ResultDesc || 'Payment was not completed',
    });
    return { handled: true, status: 'FAILED' };
  }

  const items = cb?.CallbackMetadata?.Item || [];
  const meta = (name: string) => items.find((i) => i.Name === name)?.Value;
  const paidAmount = Number(meta('Amount') || 0);
  const receipt = String(meta('MpesaReceiptNumber') || '');

  if (!receipt || paidAmount + 0.01 < payment.amount) {
    console.error(`[M-Pesa] Callback for ${checkoutRequestId} has missing receipt or short amount (${paidAmount} < ${payment.amount}). Left pending for manual review.`);
    return { handled: false, reason: 'amount/receipt mismatch' };
  }

  // The callback alone is never trusted: Safaricom must confirm the request
  // succeeded. If Daraja can't be reached right now, the payment stays PENDING
  // with the callback details recorded, and is re-verified the next time the
  // order's payment status is checked (see getMpesaStatus).
  const verification = await queryStkResult(checkoutRequestId);
  if (verification === 'FAILED') {
    console.error(`[M-Pesa] Callback for ${checkoutRequestId} claims success but Daraja query disagrees. Ignoring.`);
    return { handled: false, reason: 'verification failed' };
  }
  if (verification === 'UNKNOWN') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { notes: `${(payment.notes || '').replace(AWAITING_VERIFICATION_RE, '').trim()} ${awaitingVerificationTag(receipt, paidAmount)}`.trim() },
    });
    console.warn(`[M-Pesa] Could not verify ${checkoutRequestId} with Daraja yet; left pending for re-verification.`);
    return { handled: false, reason: 'awaiting verification' };
  }

  return online
    ? settleVerifiedStkPayment(payment.id, online, checkoutRequestId, receipt, paidAmount)
    : settleStaffStkPayment(payment.id, checkoutRequestId, receipt, paidAmount);
}

const AWAITING_VERIFICATION_RE = /\[AWAITING_VERIFICATION receipt=([A-Z0-9]+) amount=([0-9.]+)\]/i;
const awaitingVerificationTag = (receipt: string, amount: number) => `[AWAITING_VERIFICATION receipt=${receipt.replace(/[^A-Za-z0-9]/g, '').toUpperCase()} amount=${amount}]`;

async function settleVerifiedStkPayment(
  paymentId: string,
  online: { id: string; trackingToken: string; paymentState: string },
  checkoutRequestId: string,
  receipt: string,
  paidAmount: number,
) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { handled: false, reason: 'payment not found' };

  // Duplicate and cancelled-order cases are decided under the order lock inside settleOnlinePayment.
  const outcome = await settleOnlinePayment({
    onlineOrderId: online.id,
    paymentId: payment.id,
    method: 'MOBILE_MONEY',
    amount: paidAmount,
    reference: receipt,
    notes: `M-Pesa receipt ${receipt} ${CHECKOUT_TAG(checkoutRequestId)}`,
    displayMethod: 'M-Pesa',
  });
  if (outcome.alreadyPaid) {
    console.warn(`[M-Pesa] Duplicate payment ${receipt} received for already-paid order ${online.trackingToken}; flagged for refund.`);
    return { handled: true, status: 'DUPLICATE' };
  }
  if ((outcome as any).refundRequired) return { handled: true, status: 'REFUND_REQUIRED' };
  return { handled: true, status: 'PAID' };
}

/** Simulation-only: lets the demo UI complete a fake STK push. Disabled unless PAYMENT_SIMULATION=true. */
export async function confirmSimulatedMpesaPayment(checkoutRequestId: string) {
  if (!isPaymentSimulationEnabled() || !checkoutRequestId.startsWith('SIM_')) {
    throw new PaymentError('FORBIDDEN', 'M-Pesa payments are confirmed automatically by Safaricom.', 403);
  }
  const payment = await findPendingStkPayment(checkoutRequestId);
  if (!payment) throw new PaymentError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
  const online = isStaffPrompt(payment.notes) ? null : payment.sale.onlineOrder;

  const receipt = `SIM${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  if (!online) {
    await settleStaffStkPayment(payment.id, checkoutRequestId, receipt, payment.amount);
    return { success: true, paymentState: 'PAID', receiptNumber: receipt, amount: payment.amount };
  }
  await settleOnlinePayment({
    onlineOrderId: online.id,
    paymentId: payment.id,
    method: 'MOBILE_MONEY',
    amount: payment.amount,
    reference: receipt,
    notes: `SIMULATED M-Pesa receipt ${receipt} ${CHECKOUT_TAG(checkoutRequestId)}`,
    displayMethod: 'M-Pesa',
  });
  return { success: true, paymentState: 'PAID', receiptNumber: receipt, amount: payment.amount };
}

/**
 * Re-verifies a payment whose callback arrived while Daraja's status query was
 * unavailable. Safe to call repeatedly; does nothing unless the payment is
 * pending with recorded callback details. Called when the customer's tracking
 * page polls the status, and when staff open the order's payment details.
 */
export async function reverifyAwaitingPayment(checkoutRequestId: string) {
  const payment = await findPendingStkPayment(checkoutRequestId);
  const online = payment && !isStaffPrompt(payment.notes) ? payment.sale.onlineOrder : null;
  const match = payment?.notes?.match(AWAITING_VERIFICATION_RE);
  if (!payment || !match) return;
  if ((await queryStkResult(checkoutRequestId)) !== 'SUCCESS') return;
  if (online) await settleVerifiedStkPayment(payment.id, online, checkoutRequestId, match[1], Number(match[2]));
  else await settleStaffStkPayment(payment.id, checkoutRequestId, match[1], Number(match[2]));
}

export async function getMpesaStatus(checkoutRequestId: string) {
  if (!checkoutRequestId.startsWith('SIM_')) {
    try { await reverifyAwaitingPayment(checkoutRequestId); } catch (err) { console.error('[M-Pesa] Re-verification failed:', err); }
  }
  const payment = await prisma.payment.findFirst({
    where: {
      method: 'MOBILE_MONEY',
      OR: [{ reference: checkoutRequestId }, { notes: { contains: CHECKOUT_TAG(checkoutRequestId) } }],
    },
    select: { status: true, reference: true, amount: true },
  });
  if (!payment) return null;
  const status = payment.status === 'COMPLETED' ? 'SUCCESS' : payment.status;
  return {
    checkoutRequestId,
    status,
    amount: payment.amount,
    mpesaReceiptNumber: payment.status === 'COMPLETED' ? payment.reference : undefined,
  };
}

/** Last time Safaricom was asked about each prompt (per server instance), to stay within Daraja's limits. */
const lastStatusQuery = new Map<string, number>();
const LATE_CALLBACK_MS = 45_000;
const QUERY_EVERY_MS = 20_000;

/**
 * Where a staff-sent prompt stands, for the screen that is waiting on it:
 * PENDING (customer hasn't answered), SUCCESS, FAILED (with the reason),
 * REFUND_REQUIRED (paid after the bill was settled, or paid too much) or
 * ALREADY_RECORDED (the cashier typed the same receipt in by hand).
 *
 * If Safaricom's callback hasn't come 45 s after the prompt, Safaricom is asked
 * directly, so a lost callback doesn't leave the bill waiting forever.
 */
export async function getStaffMpesaStatus(checkoutRequestId: string, restaurantId: string, branchId?: string | null) {
  const where = { restaurantId, ...(branchId ? { branchId } : {}), method: 'MOBILE_MONEY', OR: [{ reference: checkoutRequestId }, { reference: `STK_${checkoutRequestId}` }, { notes: { contains: CHECKOUT_TAG(checkoutRequestId) } }] };
  let payment = await prisma.payment.findFirst({ where, select: { id: true, status: true, reference: true, amount: true, notes: true, saleId: true, createdAt: true } });
  if (!payment) return null;

  if (payment.status === 'PENDING' && !checkoutRequestId.startsWith('SIM_')) {
    try {
      await reverifyAwaitingPayment(checkoutRequestId);
      const age = Date.now() - payment.createdAt.getTime();
      const last = lastStatusQuery.get(checkoutRequestId) || 0;
      if (isStaffPrompt(payment.notes) && age > LATE_CALLBACK_MS && Date.now() - last > QUERY_EVERY_MS && !AWAITING_VERIFICATION_RE.test(payment.notes || '')) {
        lastStatusQuery.set(checkoutRequestId, Date.now());
        const answer = await queryStkResult(checkoutRequestId);
        if (answer === 'SUCCESS') await settleStaffStkPayment(payment.id, checkoutRequestId, null, payment.amount);
        if (answer === 'FAILED') {
          await prisma.payment.updateMany({
            where: { id: payment.id, status: 'PENDING' },
            data: { status: 'FAILED', notes: `${payment.notes || ''} [Failed: Safaricom says the payment was not completed]`.trim() },
          });
        }
      }
    } catch (err) {
      console.error('[M-Pesa] Status re-check failed:', err);
    }
    payment = (await prisma.payment.findFirst({ where, select: { id: true, status: true, reference: true, amount: true, notes: true, saleId: true, createdAt: true } })) || payment;
  }

  const notes = payment.notes || '';
  const failedReason = notes.match(/\[Failed: ([^\]]*)\]/)?.[1];
  const status = /already recorded by hand/.test(notes)
    ? 'ALREADY_RECORDED'
    : /REFUND/.test(notes)
      ? 'REFUND_REQUIRED'
      : payment.status === 'COMPLETED'
        ? 'SUCCESS'
        : payment.status;
  const receipt = payment.reference && !payment.reference.startsWith('STK_') && payment.reference !== checkoutRequestId ? payment.reference : undefined;
  return {
    checkoutRequestId,
    saleId: payment.saleId,
    status,
    amount: payment.amount,
    receipt,
    reason: payment.status === 'FAILED' ? failedReason || 'The customer did not complete the payment' : undefined,
    awaitingVerification: /AWAITING_VERIFICATION/.test(notes),
  };
}

/**
 * Prompts sent from the till whose answer never arrived (M-Pesa was down, or
 * Safaricom's callback was lost): ask Safaricom again. Runs when M-Pesa is
 * answering again (a new prompt went through) and when the "M-Pesa to check"
 * list is opened. A few at a time, and never the same prompt twice in 20 s.
 */
export async function recheckStuckStaffPrompts(restaurantId: string, branchId?: string | null, limit = 10) {
  const now = Date.now();
  const stuck = await prisma.payment.findMany({
    where: {
      restaurantId, ...(branchId ? { branchId } : {}), method: 'MOBILE_MONEY', status: 'PENDING',
      notes: { contains: STAFF_PROMPT_TAG },
      createdAt: { lt: new Date(now - 2 * 60_000), gt: new Date(now - 48 * 60 * 60_000) },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, notes: true, reference: true, amount: true },
  });
  const out = { checked: 0, settled: 0, failed: 0, unknown: 0 };
  const deadline = Date.now() + 20_000;
  for (const p of stuck) {
    if (Date.now() > deadline) { out.unknown++; continue; }
    const id = p.notes?.match(/\[CheckoutRequestID: ([^\]]+)\]/)?.[1] || p.reference?.replace(/^STK_/, '');
    if (!id || id.startsWith('SIM_') || id.startsWith('PROMPT_') || now - (lastStatusQuery.get(id) || 0) < QUERY_EVERY_MS) { out.unknown++; continue; }
    lastStatusQuery.set(id, now);
    out.checked++;
    try {
      if (AWAITING_VERIFICATION_RE.test(p.notes || '')) { await reverifyAwaitingPayment(id); continue; }
      const answer = await queryStkResult(id);
      if (answer === 'SUCCESS') { await settleStaffStkPayment(p.id, id, null, p.amount); out.settled++; }
      else if (answer === 'FAILED') {
        await prisma.payment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'FAILED', notes: `${p.notes || ''} [Failed: Safaricom says the payment was not completed]`.trim() } });
        out.failed++;
      } else out.unknown++;
    } catch (err) {
      console.error('[M-Pesa] re-check failed:', err);
      out.unknown++;
    }
  }
  return out;
}
