import crypto from 'crypto';
import prisma from '../config/database';
import { darajaPost, mpesaCallbackBase, mpesaEnvironment, mpesaReceiptLockKey } from './mpesaService';
import { isPaymentSimulationEnabled } from './onlinePaymentService';
import { realtimeService } from './realtimeService';
import { createAuditLog } from './auditLogService';
import { maskPhone } from './smsService';

/**
 * Payments customers send straight to a branch's till (Safaricom C2B): stored
 * as they arrive, shown at the POS to attach to a bill, and matched to M-Pesa
 * codes already typed in.
 */

type C2BConfirmation = {
  TransID?: string; TransTime?: string; TransAmount?: string | number; BusinessShortCode?: string;
  BillRefNumber?: string; MSISDN?: string; FirstName?: string;
};
type TillBranch = { id: string; restaurantId: string; mpesaShortcode: string | null };

/** Marks test payments so the daily check leaves them out. */
export const SIMULATED_BILL_REF = 'SIMULATED';

/** "20261124140211" (Kenya time) → Date; missing or in the future → now. */
const darajaTime = (v?: string) => {
  const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`) : null;
  return d && !Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 10 * 60_000 ? d : new Date();
};

// Only a hash is stored: branch rows reach staff screens, the callback secret must not.
const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** The registered branch whose callback address carries this token. */
export const branchForCallbackToken = (token: string) =>
  /^[a-f0-9]{48}$/.test(token)
    ? prisma.branch.findFirst({ where: { mpesaCallbackToken: tokenHash(token), mpesaRegisteredAt: { not: null } }, select: { id: true, restaurantId: true, mpesaShortcode: true } })
    : Promise.resolve(null);

/** Saves one confirmation (once per M-Pesa code) and links it to a payment already carrying that code. */
export async function handleTillConfirmation(branch: TillBranch, body: C2BConfirmation) {
  const transId = String(body.TransID || '').toUpperCase();
  const amount = Number(body.TransAmount);
  const shortcode = String(body.BusinessShortCode || '');
  if (!/^[A-Z0-9]{10}$/.test(transId) || !(amount > 0)) return { stored: false, reason: 'incomplete' };
  if (shortcode !== branch.mpesaShortcode) return { stored: false, reason: 'another till' };
  const msisdn = String(body.MSISDN || '').replace(/\D/g, '');

  const out = await prisma.$transaction(async (tx) => {
    // Same lock as a cashier typing this code or a prompt settling with it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mpesaReceiptLockKey(branch.restaurantId, transId)}))`;
    if (await tx.mpesaTransaction.findUnique({ where: { transId }, select: { id: true } })) return { stored: false, reason: 'already stored' };
    const existing = await tx.payment.findFirst({
      where: { restaurantId: branch.restaurantId, method: 'MOBILE_MONEY', reference: transId, status: { in: ['COMPLETED', 'REFUNDED', 'DUPLICATE'] } },
      select: { id: true, amount: true, status: true, verifyStatus: true },
    });
    await tx.mpesaTransaction.create({
      data: {
        restaurantId: branch.restaurantId, branchId: branch.id, shortcode, transId, amount,
        transTime: darajaTime(body.TransTime),
        // Only the masked number is kept: the POS never needs the full one.
        msisdn: /^\d{12}$/.test(msisdn) ? maskPhone(msisdn) : null,
        firstName: body.FirstName ? String(body.FirstName).slice(0, 60) : null,
        billRef: body.BillRefNumber ? String(body.BillRefNumber).slice(0, 60) : null,
        paymentId: existing?.id || null,
      },
    });
    // The cashier recorded it "M-Pesa down" with this code: Safaricom has now confirmed it.
    if (existing?.verifyStatus === 'PENDING_CHECK' && existing.status === 'COMPLETED' && Math.abs(existing.amount - amount) <= 1) {
      await tx.payment.update({ where: { id: existing.id }, data: { verifyStatus: 'CONFIRMED', verifiedAt: new Date() } });
      return { stored: true, confirmed: existing.id };
    }
    return { stored: true };
  });
  if (out.confirmed) {
    await createAuditLog(branch.restaurantId, null, 'UPDATE', 'Payment', out.confirmed, `M-Pesa payment ${transId} confirmed by Safaricom's till notification`);
  }
  if (out.stored) realtimeService.broadcast(`orders:${branch.id}`, 'till_payment', {});
  return out;
}

/** Payments to the branch's till in the last day not yet on any bill (nor arriving through a prompt). */
export async function incomingTillPayments(restaurantId: string, branchId: string) {
  const rows = await prisma.mpesaTransaction.findMany({
    where: { restaurantId, branchId, paymentId: null, transTime: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { transTime: 'desc' },
    take: 50,
    select: { id: true, transId: true, amount: true, transTime: true, firstName: true, msisdn: true },
  });
  if (!rows.length) return rows;
  const codes = rows.map((r) => r.transId);
  const taken = await prisma.payment.findMany({
    where: {
      restaurantId, method: 'MOBILE_MONEY',
      OR: [
        { reference: { in: codes }, status: { in: ['COMPLETED', 'REFUNDED', 'DUPLICATE'] } },
        { status: 'PENDING', OR: codes.map((c) => ({ notes: { contains: `receipt=${c}` } })) },
      ],
    },
    select: { reference: true, notes: true },
  });
  const busy = (code: string) => taken.some((p) => p.reference === code || p.notes?.includes(`receipt=${code}`));
  return rows.filter((r) => !busy(r.transId));
}

/**
 * Asks Safaricom to send this till's payments to Melio (register URL). Each
 * branch gets its own secret callback address. Needs Daraja credentials that
 * may register this till (in the sandbox, the sandbox test shortcode).
 */
export async function registerTill(branch: { id: string; mpesaShortcode: string | null }) {
  if (!branch.mpesaShortcode) throw new Error('NO_TILL');
  if (!mpesaCallbackBase()) throw new Error('NOT_CONFIGURED');
  if (mpesaEnvironment() === 'production' && !process.env.MPESA_CALLBACK_ALLOWED_IPS) throw new Error('NO_IP_ALLOWLIST');
  // A new address each time: the old one stops working once Safaricom accepts the new one.
  const token = crypto.randomBytes(24).toString('hex');
  const url = (path: string) => `${mpesaCallbackBase()}/api/public/till/${path}/${token}`;
  const version = process.env.MPESA_C2B_VERSION || (mpesaEnvironment() === 'production' ? 'v2' : 'v1');
  const res = await darajaPost<{ ResponseCode?: string; ResponseDescription?: string }>(`/mpesa/c2b/${version}/registerurl`, {
    ShortCode: branch.mpesaShortcode,
    // If Melio can't be reached, Safaricom still completes the payment.
    ResponseType: 'Completed',
    ConfirmationURL: url('confirm'),
    ValidationURL: url('validate'),
  });
  if (res?.ResponseCode !== undefined && String(res.ResponseCode) !== '0') throw new Error(res.ResponseDescription || `code ${res.ResponseCode}`);
  await prisma.branch.update({ where: { id: branch.id }, data: { mpesaRegisteredAt: new Date(), mpesaCallbackToken: tokenHash(token) } });
}

/**
 * A test payment to the till. Never on a live till. In test mode it is created
 * here; in the Daraja sandbox Safaricom sends it through the real callback.
 */
export async function simulateTillPayment(branch: TillBranch & { mpesaShortcodeType: string | null }, amount: number) {
  if (mpesaEnvironment() === 'production') throw new Error('NOT_IN_PRODUCTION');
  if (!branch.mpesaShortcode) throw new Error('NO_TILL');
  if (isPaymentSimulationEnabled()) {
    const transId = `T${crypto.randomBytes(8).toString('hex').toUpperCase()}`.slice(0, 10);
    const t = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return { transId, ...(await handleTillConfirmation(branch, { TransID: transId, TransTime: t, TransAmount: amount, BusinessShortCode: branch.mpesaShortcode, FirstName: 'TEST', MSISDN: '254708374149', BillRefNumber: SIMULATED_BILL_REF })) };
  }
  await darajaPost('/mpesa/c2b/v1/simulate', {
    ShortCode: branch.mpesaShortcode,
    CommandID: branch.mpesaShortcodeType === 'PAYBILL' ? 'CustomerPayBillOnline' : 'CustomerBuyGoodsOnline',
    Amount: Math.round(amount),
    Msisdn: '254708374149',
    BillRefNumber: SIMULATED_BILL_REF,
  });
  return { sent: true };
}
