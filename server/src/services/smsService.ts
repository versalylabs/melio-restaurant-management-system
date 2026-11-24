import { createHash, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * SMS through Africa's Talking. With AT_USERNAME and AT_API_KEY set, messages
 * are really sent (AT_USERNAME=sandbox uses their test sandbox). Without them
 * the system runs in test mode: every message is still written to the SMS log
 * so the restaurant can see exactly what customers would get.
 */
export type SmsLanguage = 'en' | 'sw';
export const smsMode = (): 'LIVE' | 'SANDBOX' | 'TEST' => {
  const user = (process.env.AT_USERNAME || '').trim();
  if (!user || !(process.env.AT_API_KEY || '').trim()) return 'TEST';
  return user === 'sandbox' ? 'SANDBOX' : 'LIVE';
};
export const smsSenderId = () => (process.env.AT_SENDER_ID || '').trim() || null;
/** A two-way shortcode customers can reply STOP to; a sender name alone is one-way. */
export const smsReplyCode = () => (process.env.AT_SHORTCODE || '').trim() || null;

/** Kenyan mobile number → 2547XXXXXXXX / 2541XXXXXXXX, or null. */
export function kenyanPhone(raw?: string | null): string | null {
  let d = String(raw || '').replace(/[^0-9]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('2540')) d = '254' + d.slice(4);
  if (d.startsWith('0')) d = '254' + d.slice(1);
  else if (d.length === 9 && /^[17]/.test(d)) d = '254' + d;
  return /^254[17]\d{8}$/.test(d) ? d : null;
}
/** 0712 345 678, for showing and storing the way staff type it. */
export const localPhone = (intl: string) => `0${intl.slice(3)}`;
/** 2547*****678: enough to recognise, not enough to copy. */
export const maskPhone = (intl: string) => `${intl.slice(0, 4)}*****${intl.slice(-3)}`;

/**
 * Customers of a restaurant (or every restaurant) whose saved Kenyan number is
 * this phone, however it was typed. Active ones first, then the oldest.
 */
export async function customersByPhone(restaurantId: string | null, phone: string, db: Db = prisma) {
  const last9 = phone.slice(-9);
  // Only numbers that look Kenyan (07…, 01…, 2547…, +254…), so a +255 number never matches.
  const rows = restaurantId
    ? await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "customers"
        WHERE "restaurantId" = ${restaurantId}
          AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') ~ ('^(0|254|2540|00254)?' || ${last9} || '$')
        ORDER BY (status = 'ACTIVE') DESC, "createdAt" ASC`
    : await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "customers"
        WHERE regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') ~ ('^(0|254|2540|00254)?' || ${last9} || '$')
        ORDER BY "createdAt" ASC`;
  return rows.map((r) => r.id);
}

/** Opted out: the number replied STOP (or the network blocks it), or staff marked the customer. */
export async function isOptedOut(restaurantId: string, phone: string, customerId?: string | null, db: Db = prisma) {
  if (await db.smsOptOut.findUnique({ where: { phone } })) return true;
  const ids = await customersByPhone(restaurantId, phone, db);
  if (customerId && !ids.includes(customerId)) ids.push(customerId);
  if (!ids.length) return false;
  return (await db.customer.count({ where: { id: { in: ids }, smsOptOutAt: { not: null } } })) > 0;
}

/** Records an opt-out for a number, and on every customer saved with it. */
export async function optOutNumber(phone: string, source: 'SMS' | 'BLACKLIST') {
  await prisma.smsOptOut.upsert({ where: { phone }, create: { phone, source }, update: {} });
  const ids = await customersByPhone(null, phone);
  if (ids.length) {
    await prisma.customer.updateMany({ where: { id: { in: ids }, smsOptOutAt: null }, data: { smsOptOutAt: new Date(), smsOptOutSource: source, marketingConsent: false } });
  }
}

/**
 * Keeps a job running after the response on Vercel (their request context's
 * waitUntil); elsewhere the promise simply runs on.
 */
export function afterResponse(work: Promise<unknown>) {
  const safe = work.catch((err) => console.error('[after response]', err));
  try {
    const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
    if (ctx?.waitUntil) ctx.waitUntil(safe);
  } catch {
    /* not on Vercel */
  }
}

async function deliver(to: string, message: string): Promise<{ ok: boolean; providerId?: string; cost?: string; error?: string; blacklisted?: boolean }> {
  const mode = smsMode();
  const url = mode === 'SANDBOX' ? 'https://api.sandbox.africastalking.com/version1/messaging' : 'https://api.africastalking.com/version1/messaging';
  const form = new URLSearchParams({ username: process.env.AT_USERNAME!.trim(), to: `+${to}`, message });
  const from = smsSenderId();
  if (from) form.set('from', from);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apiKey: process.env.AT_API_KEY!.trim(), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const r = json?.SMSMessageData?.Recipients?.[0];
    if (res.ok && r && (r.status === 'Success' || [100, 101, 102].includes(Number(r.statusCode)))) {
      return { ok: true, providerId: r.messageId, cost: r.cost };
    }
    const blacklisted = Number(r?.statusCode) === 406 || /blacklist/i.test(String(r?.status || ''));
    return { ok: false, blacklisted, error: String(r?.status || json?.SMSMessageData?.Message || text || `HTTP ${res.status}`).slice(0, 300) };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? "Timed out reaching Africa's Talking" : String(err?.message || err).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one SMS and logs it. Never throws: a failed SMS must not fail a sale.
 * With a saleId, each kind goes once per order; a failed or abandoned attempt
 * (older than two minutes) may be tried again.
 */
export async function sendSms(input: {
  restaurantId: string;
  phone: string | null | undefined;
  kind: string;
  body: string;
  language?: SmsLanguage;
  customerId?: string | null;
  saleId?: string | null;
}): Promise<{ status: string; id?: string }> {
  try {
    const to = kenyanPhone(input.phone);
    if (!to) return { status: 'NO_NUMBER' };
    const data = {
      restaurantId: input.restaurantId, customerId: input.customerId || null, saleId: input.saleId || null,
      phone: to, kind: input.kind, language: input.language || 'en', body: input.body, status: 'QUEUED', error: null,
    };
    let record;
    try {
      record = await prisma.smsMessage.create({ data });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') || !input.saleId) throw err;
      const stale = new Date(Date.now() - 2 * 60 * 1000);
      const reclaimed = await prisma.smsMessage.updateMany({
        where: { saleId: input.saleId, kind: input.kind, OR: [{ status: 'FAILED' }, { status: 'QUEUED', createdAt: { lt: stale } }] },
        data: { ...data, createdAt: new Date() },
      });
      if (!reclaimed.count) return { status: 'DUPLICATE' };
      record = await prisma.smsMessage.findFirstOrThrow({ where: { saleId: input.saleId, kind: input.kind } });
    }
    if (await isOptedOut(input.restaurantId, to, input.customerId)) {
      await prisma.smsMessage.update({ where: { id: record.id }, data: { status: 'SKIPPED', error: 'Customer asked for no SMS' } });
      return { status: 'SKIPPED', id: record.id };
    }
    if (smsMode() === 'TEST') {
      console.log(`[SMS test mode -> ${maskPhone(to)}] ${input.body}`);
      await prisma.smsMessage.update({ where: { id: record.id }, data: { status: 'SIMULATED' } });
      return { status: 'SIMULATED', id: record.id };
    }
    const out = await deliver(to, input.body);
    await prisma.smsMessage.update({
      where: { id: record.id },
      data: out.ok ? { status: 'SENT', providerId: out.providerId, cost: out.cost } : out.blacklisted ? { status: 'SKIPPED', error: 'The network has this number on its do-not-send list' } : { status: 'FAILED', error: out.error },
    });
    if (out.blacklisted) await optOutNumber(to, 'BLACKLIST');
    else if (!out.ok) console.error(`[SMS] to ${maskPhone(to)} failed: ${out.error}`);
    return { status: out.ok ? 'SENT' : out.blacklisted ? 'SKIPPED' : 'FAILED', id: record.id };
  } catch (err) {
    console.error('[SMS] could not send:', err);
    return { status: 'FAILED' };
  }
}

/**
 * A reply to the SMS shortcode. STOP (or ACHA / ONDOA) turns off all SMS and
 * offers for that number. START / ANZA lifts only a STOP sent by SMS: an
 * opt-out staff recorded stays until staff change it, and offers stay off
 * until the customer agrees again.
 */
export async function handleInboundSms(from: string, text: string) {
  const phone = kenyanPhone(from);
  if (!phone) return 'IGNORED';
  const word = String(text || '').trim().split(/\s+/)[0]?.toUpperCase() || '';
  if (['STOP', 'ACHA', 'ONDOA', 'UNSUBSCRIBE', 'STOPALL', 'CANCEL'].includes(word)) {
    await optOutNumber(phone, 'SMS');
    return 'OPTED_OUT';
  }
  if (['START', 'ANZA'].includes(word)) {
    await prisma.smsOptOut.deleteMany({ where: { phone, source: 'SMS' } });
    const ids = await customersByPhone(null, phone);
    if (ids.length) await prisma.customer.updateMany({ where: { id: { in: ids }, smsOptOutSource: 'SMS' }, data: { smsOptOutAt: null, smsOptOutSource: null } });
    return 'OPTED_IN';
  }
  return 'IGNORED';
}

/** Constant-time check of the webhook key (hashing first, so lengths never matter). */
export function webhookKeyOk(given: string) {
  const secret = process.env.SMS_WEBHOOK_SECRET || '';
  if (secret.length < 16 || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
