import crypto from 'crypto';
import prisma from '../config/database';
import { realtimeService } from './realtimeService';
import { isPaymentSimulationEnabled, PaymentError, settleOnlinePayment } from './onlinePaymentService';

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
  });
  if (!res.ok) throw new PaymentError('MPESA_AUTH_FAILED', 'Could not reach M-Pesa. Please try again shortly.', 502);
  const body = (await res.json()) as { access_token: string; expires_in: string | number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3599) * 1000 };
  return body.access_token;
}

async function darajaPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${config().baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
  // Daraja only accepts whole shillings.
  const chargeAmount = Math.ceil(payableAmount);

  let checkoutRequestId: string;
  let merchantRequestId: string;

  if (simulated) {
    checkoutRequestId = `SIM_ws_CO_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    merchantRequestId = `SIM_MR_${crypto.randomBytes(4).toString('hex')}`;
  } else {
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
        AccountReference: online.sale.orderNumber.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'MELIO',
        TransactionDesc: 'Melio order',
      },
    );
    if (String(response.ResponseCode) !== '0') {
      throw new PaymentError('MPESA_REJECTED', response.ResponseDescription || 'M-Pesa could not start the payment', 502);
    }
    checkoutRequestId = response.CheckoutRequestID;
    merchantRequestId = response.MerchantRequestID;
  }

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
      data: { method: 'MOBILE_MONEY', amount: payableAmount, reference: checkoutRequestId, notes },
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

function verifyCallbackToken(token: unknown): boolean {
  const secret = config().callbackSecret;
  if (!secret || typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Ask Safaricom directly whether the STK request succeeded (defence in depth on top of the callback secret). */
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
    return String(result.ResultCode) === '0' ? 'SUCCESS' : 'FAILED';
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
export async function handleMpesaCallback(body: StkCallbackBody, token: unknown) {
  if (!verifyCallbackToken(token)) throw new PaymentError('UNAUTHORIZED', 'Invalid callback token', 401);

  const cb = body?.Body?.stkCallback;
  const checkoutRequestId = cb?.CheckoutRequestID ? String(cb.CheckoutRequestID) : '';
  if (!checkoutRequestId) return { handled: false, reason: 'missing CheckoutRequestID' };

  const payment = await findPendingStkPayment(checkoutRequestId);
  const online = payment?.sale.onlineOrder;
  if (!payment || !online) return { handled: false, reason: 'no pending payment for this request' };

  if (String(cb?.ResultCode) !== '0') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', notes: `${payment.notes || ''} [Failed: ${cb?.ResultDesc || 'cancelled'}]`.trim() },
    });
    realtimeService.broadcast(`order-tracking:${online.trackingToken}`, 'payment_failed', {
      trackingToken: online.trackingToken,
      method: 'M-Pesa',
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

  return settleVerifiedStkPayment(payment.id, online, checkoutRequestId, receipt, paidAmount);
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

  if (online.paymentState === 'PAID') {
    // Customer paid twice (e.g. retried STK push). Keep a record so staff can refund it.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'DUPLICATE', reference: receipt, notes: `${payment.notes || ''} [Duplicate payment ${paidAmount} — refund required]`.trim() },
    });
    console.warn(`[M-Pesa] Duplicate payment ${receipt} received for already-paid order ${online.trackingToken}.`);
    return { handled: true, status: 'DUPLICATE' };
  }

  await settleOnlinePayment({
    onlineOrderId: online.id,
    paymentId: payment.id,
    method: 'MOBILE_MONEY',
    amount: paidAmount,
    reference: receipt,
    notes: `M-Pesa receipt ${receipt} ${CHECKOUT_TAG(checkoutRequestId)}`,
    displayMethod: 'M-Pesa',
  });
  return { handled: true, status: 'PAID' };
}

/** Simulation-only: lets the demo UI complete a fake STK push. Disabled unless PAYMENT_SIMULATION=true. */
export async function confirmSimulatedMpesaPayment(checkoutRequestId: string) {
  if (!isPaymentSimulationEnabled() || !checkoutRequestId.startsWith('SIM_')) {
    throw new PaymentError('FORBIDDEN', 'M-Pesa payments are confirmed automatically by Safaricom.', 403);
  }
  const payment = await findPendingStkPayment(checkoutRequestId);
  const online = payment?.sale.onlineOrder;
  if (!payment || !online) throw new PaymentError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);

  const receipt = `SIM${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
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
  const online = payment?.sale.onlineOrder;
  const match = payment?.notes?.match(AWAITING_VERIFICATION_RE);
  if (!payment || !online || !match) return;
  if ((await queryStkResult(checkoutRequestId)) !== 'SUCCESS') return;
  await settleVerifiedStkPayment(payment.id, online, checkoutRequestId, match[1], Number(match[2]));
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
