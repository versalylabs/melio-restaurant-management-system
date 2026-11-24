import crypto from 'crypto';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { notifyRestaurantStaff } from './notificationService';

/**
 * KRA eTIMS through the OSCU API: each branch sets up a KRA device, menu items
 * are registered with KRA, and every receipt and refund is sent to KRA to be
 * signed. Anything KRA can't take right away is retried; anything KRA refuses
 * stays on a visible "not signed" list.
 *
 * Field names and codes follow KRA's OSCU specification v2.0 as used by open
 * implementations; confirm them on the first sandbox run (see KRA_CODES).
 */

type Tx = Prisma.TransactionClient;
/** 'test' is the built-in simulated KRA (ETIMS_SIMULATION=true). */
type Env = 'sandbox' | 'production' | 'test';

const API: Record<'sandbox' | 'production', string> = { sandbox: 'https://etims-api-sbx.kra.go.ke/etims-api', production: 'https://etims-api.kra.go.ke/etims-api' };
const RECEIPT_PAGE: Record<'sandbox' | 'production', string> = {
  sandbox: 'https://etims-sbx.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData',
  production: 'https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData',
};

/** KRA code values in one place, so they are easy to correct after the first sandbox run. */
export const KRA_CODES = {
  taxRates: { A: 0, B: 16, C: 0, D: 0, E: 8 } as Record<string, number>, // A exempt, B standard, C zero-rated, D non-VAT, E reduced
  payment: { CASH: '01', CARD: '05', MOBILE_MONEY: '06', OTHER: '07' } as Record<string, string>,
  finishedProduct: '2',
  service: '3',
  packagingUnit: 'NT',
  quantityUnit: 'U',
  refundReason: '06',
  // shortcut: Melio adds no VAT to the service charge, so it goes to KRA as exempt; confirm with an accountant.
  serviceChargeTax: 'A',
};

export const etimsEnvironment = (): 'sandbox' | 'production' => (process.env.ETIMS_ENVIRONMENT === 'production' ? 'production' : 'sandbox');
const simulated = () => process.env.ETIMS_SIMULATION === 'true';

export class KraError extends Error {
  constructor(public code: string, message: string, public permanent: boolean) {
    super(message);
  }
  /** KRA already has this record (a resend after a lost answer). */
  get duplicate() {
    return this.code === '921' || this.code === '994';
  }
}

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
/** KRA wants Kenya time: yyyyMMddHHmmss and yyyyMMdd. */
const kraTime = (d: Date) => {
  const k = new Date(d.getTime() + 3 * 3_600_000);
  return `${k.getUTCFullYear()}${pad(k.getUTCMonth() + 1)}${pad(k.getUTCDate())}${pad(k.getUTCHours())}${pad(k.getUTCMinutes())}${pad(k.getUTCSeconds())}`;
};
const kraDate = (d: Date) => kraTime(d).slice(0, 8);

type Auth = { tin: string; bhfId: string; cmcKey: string };

async function kraPost(env: Env, path: string, body: Record<string, unknown>, auth?: Auth, timeoutMs = 20_000): Promise<any> {
  if (env === 'test') return simulateKra(path, body);
  let res: Response;
  try {
    res = await fetch(`${API[env]}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(auth || {}) },
      // The specification lists tin, bhfId and cmcKey as fields too: send them both ways.
      body: JSON.stringify(auth ? { ...auth, ...body } : body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new KraError('NETWORK', `KRA could not be reached (${err?.name === 'TimeoutError' ? 'timed out' : 'network error'})`, false);
  }
  const json: any = await res.json().catch(() => null);
  if (!json) throw new KraError(`HTTP${res.status}`, `KRA answered with an error page (${res.status})`, false);
  const code = String(json.resultCd ?? '');
  if (code === '000') return json.data || {};
  // 99x are KRA's own server errors: try again later. Anything else is about the request.
  throw new KraError(code, `KRA ${code}: ${json.resultMsg || 'refused'}`, !code.startsWith('99'));
}

/** Test mode: answers like KRA, and refuses invoices whose sums don't add up. */
function simulateKra(path: string, body: any) {
  if (process.env.ETIMS_SIMULATE_DOWN === 'true') throw new KraError('NETWORK', 'KRA could not be reached (test)', false);
  const rand = () => crypto.randomBytes(8).toString('hex').toUpperCase();
  if (path === '/selectInitOsdcInfo') return { info: { cmcKey: `SIM${rand()}`, sdcId: 'KRACU0100000001', mrcNo: 'WIS00000001' } };
  if (path === '/saveItem') return {};
  if (path === '/saveTrnsSalesOsdc') {
    const lines: any[] = body.itemList || [];
    const sum = (k: string) => money(lines.reduce((s, l) => s + l[k], 0));
    const ok = lines.length === body.totItemCnt
      && lines.every((l) => money(l.splyAmt - l.dcAmt) === l.taxblAmt && l.totAmt === l.taxblAmt)
      && sum('taxblAmt') === body.totTaxblAmt && sum('taxAmt') === body.totTaxAmt && sum('totAmt') === body.totAmt
      && Number.isInteger(body.invcNo) && body.invcNo > 0;
    if (!ok) throw new KraError('910', 'KRA 910: Request parameter error (test check: amounts do not add up)', true);
    return { curRcptNo: body.invcNo, totRcptNo: body.invcNo, intrlData: rand(), rcptSign: rand(), sdcDateTime: kraTime(new Date()) };
  }
  throw new KraError('910', `Unknown path ${path}`, true);
}

// ---------------------------------------------------------------------------
// Device set-up

export async function setUpEtimsDevice(restaurantId: string, branchId: string, input: { bhfId: string; serialNumber: string; itemClassCode: string }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { kraPin: true } });
  if (!restaurant?.kraPin) throw new KraError('NO_PIN', "Add the business's KRA PIN in Settings first", true);
  const env: Env = simulated() ? 'test' : etimsEnvironment();
  const data = await kraPost(env, '/selectInitOsdcInfo', { tin: restaurant.kraPin, bhfId: input.bhfId, dvcSrlNo: input.serialNumber });
  const info = data?.info || {};
  if (!info.cmcKey) throw new KraError('NO_KEY', 'KRA did not return a device key. Check the PIN, branch number and serial number.', true);
  const existing = await prisma.etimsDevice.findUnique({ where: { branchId } });
  const fresh = !existing || existing.bhfId !== input.bhfId || existing.environment !== env;
  const device = { bhfId: input.bhfId, serialNumber: input.serialNumber, itemClassCode: input.itemClassCode, cmcKey: String(info.cmcKey), sdcId: info.sdcId || info.sdicId || null, mrcNo: info.mrcNo || null, environment: env };
  await prisma.$transaction(async (tx) => {
    if (fresh) {
      // Numbers continue where this KRA branch and environment left off (never reused).
      const last = await tx.etimsInvoice.aggregate({ where: { branchId, environment: env, bhfId: input.bhfId }, _max: { invoiceNo: true } });
      // Items are registered again under new codes (the item counter never goes back).
      await tx.etimsItem.deleteMany({ where: { branchId } });
      // Unsent invoices: a switch between test and live drops them; otherwise they go to the new device.
      await tx.etimsInvoice.updateMany({
        where: { branchId, status: { in: ['PENDING', 'REJECTED'] } },
        data: existing && existing.environment !== env
          ? { status: 'DROPPED', lastError: `Not sent: the branch was connected to KRA's ${env === 'production' ? 'live' : 'test'} system instead`, lockedUntil: null }
          : { status: 'PENDING', invoiceNo: null, environment: null, bhfId: null, nextTryAt: new Date(), lockedUntil: null },
      });
      await tx.etimsDevice.upsert({
        where: { branchId },
        create: { branchId, restaurantId, ...device, lastInvoiceNo: last._max.invoiceNo || 0 },
        update: { ...device, lastInvoiceNo: last._max.invoiceNo || 0 },
      });
    } else {
      await tx.etimsDevice.update({ where: { branchId }, data: device });
    }
  });
}

// ---------------------------------------------------------------------------
// Queueing (inside the transaction that issues the receipt or refund)

export async function queueEtimsSale(tx: Tx, sale: { id: string; restaurantId: string; branchId: string }) {
  if (!(await tx.etimsDevice.findUnique({ where: { branchId: sale.branchId }, select: { branchId: true } }))) return;
  await tx.etimsInvoice.createMany({ data: [{ restaurantId: sale.restaurantId, branchId: sale.branchId, saleId: sale.id, kind: 'SALE', key: `S:${sale.id}` }], skipDuplicates: true });
}

/** The bill's latest invoice to KRA (a bill paid again after a refund has more than one). */
const latestSale = (db: Tx | typeof prisma, saleId: string, before?: Date) =>
  db.etimsInvoice.findFirst({ where: { saleId, kind: 'SALE', status: { not: 'DROPPED' }, ...(before ? { createdAt: { lt: before } } : {}) }, orderBy: { createdAt: 'desc' } });

/**
 * A bill paid again after a refund: KRA's net for it (invoices minus credit
 * notes) is now short of what was paid, so KRA gets a new invoice for the difference.
 */
export async function topUpEtimsSale(tx: Tx, sale: { id: string }) {
  const invoices = await tx.etimsInvoice.findMany({ where: { saleId: sale.id, status: { in: ['PENDING', 'SIGNED'] } }, select: { kind: true, amount: true } });
  if (!invoices.some((i) => i.kind === 'SALE')) return;
  const bill = (await tx.sale.findUnique({ where: { id: sale.id }, select: { totalAmount: true, restaurantId: true, branchId: true } }))!;
  const net = invoices.reduce((t, i) => t + (i.kind === 'SALE' ? i.amount ?? bill.totalAmount : -(i.amount || 0)), 0);
  const missing = money(bill.totalAmount - net);
  if (missing <= 0.01) return;
  const n = await tx.etimsInvoice.count({ where: { saleId: sale.id, kind: 'SALE' } });
  await tx.etimsInvoice.createMany({ data: [{ restaurantId: bill.restaurantId, branchId: bill.branchId, saleId: sale.id, kind: 'SALE', key: `S:${sale.id}:${n + 1}`, amount: missing }], skipDuplicates: true });
}

/** A refund of a bill that went to KRA: a credit note (with Melio's credit note, or for a refund before the bill was closed). */
export async function queueEtimsCredit(tx: Tx, input: { restaurantId: string; branchId: string; saleId: string; amount: number; key: string; reference?: string; creditNoteId?: string }) {
  if (!(await latestSale(tx, input.saleId))) return;
  await tx.etimsInvoice.createMany({
    data: [{ restaurantId: input.restaurantId, branchId: input.branchId, saleId: input.saleId, creditNoteId: input.creditNoteId || null, kind: 'CREDIT_NOTE', key: input.key, amount: money(input.amount), reference: input.reference || null }],
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Invoice lines

export type EtimsLine = {
  itemKey: string; name: string; itemType: string; taxType: string;
  qty: number; prc: number; splyAmt: number; dcRt: number; dcAmt: number; taxblAmt: number; taxAmt: number; totAmt: number;
};
type SaleForLines = {
  subtotal: number; discountAmount: number; serviceChargeAmount: number; taxInclusive: boolean; taxAmount: number;
  taxableAmount: number; zeroRatedAmount: number; exemptAmount: number; totalAmount: number;
  items: Array<{ menuItemId: string; itemNameSnapshot: string; unitPrice: number; quantity: number; modifiers: Array<{ priceAdjustment: number }> }>;
};

/**
 * The bill as KRA lines, adding up to `target` (the bill total, or the refund).
 * eTIMS amounts include VAT, so standard-rated prices of a bill that added VAT
 * on top are grossed up at the bill's own rate. Each VAT category gets the
 * discount it actually had on the bill. `scale` shrinks prices for a partial refund.
 */
export function etimsLines(sale: SaleForLines, categoryOf: (menuItemId: string) => string, vatRegistered: boolean, target: number, scale = 1): EtimsLine[] {
  const billRate = sale.taxableAmount > 0 ? Math.round((sale.taxAmount / sale.taxableAmount) * 10000) / 100 : 0;
  const rateB = billRate > 0 ? billRate : KRA_CODES.taxRates.B;
  const grossUp = !sale.taxInclusive && sale.taxAmount > 0;
  const cat = (id: string) => (['ZERO_RATED', 'EXEMPT'].includes(categoryOf(id)) ? categoryOf(id) : 'STANDARD');
  const typeOf = (c: string) => (!vatRegistered ? 'D' : c === 'ZERO_RATED' ? 'C' : c === 'EXEMPT' ? 'A' : 'B');
  const rateOf = (t: string) => (t === 'B' ? rateB : KRA_CODES.taxRates[t] || 0);
  const unitOf = (i: SaleForLines['items'][number]) => {
    const unit = i.unitPrice + i.modifiers.reduce((s, m) => s + Math.max(0, m.priceAdjustment), 0);
    return grossUp && cat(i.menuItemId) === 'STANDARD' ? unit * (1 + billRate / 100) : unit;
  };

  // What each category was charged after its discount (VAT included), from the bill itself.
  const before: Record<string, number> = { STANDARD: 0, ZERO_RATED: 0, EXEMPT: 0 };
  sale.items.forEach((i) => { before[cat(i.menuItemId)] += unitOf(i) * i.quantity; });
  const hasBreakdown = sale.taxableAmount + sale.zeroRatedAmount + sale.exemptAmount > 0;
  const charged: Record<string, number> = { STANDARD: sale.taxableAmount + sale.taxAmount, ZERO_RATED: sale.zeroRatedAmount, EXEMPT: sale.exemptAmount };
  const dcRtOf = (c: string) => {
    if (!hasBreakdown) return sale.subtotal > 0 ? Math.round((sale.discountAmount / sale.subtotal) * 1_000_000) / 10_000 : 0; // older bills
    return before[c] > 0 ? Math.min(100, Math.max(0, Math.round((1 - charged[c] / before[c]) * 1_000_000) / 10_000)) : 0;
  };

  const line = (itemKey: string, name: string, itemType: string, taxType: string, unit: number, qty: number, dcRt: number): EtimsLine => {
    const prc = money(unit * scale);
    const splyAmt = money(prc * qty);
    const dcAmt = money((splyAmt * dcRt) / 100);
    const taxblAmt = money(splyAmt - dcAmt);
    const r = rateOf(taxType);
    return { itemKey, name: name.slice(0, 200), itemType, taxType, qty, prc, splyAmt, dcRt, dcAmt, taxblAmt, taxAmt: money((taxblAmt * r) / (100 + r)), totAmt: taxblAmt };
  };
  const lines = sale.items.filter((i) => i.quantity > 0).map((i) =>
    line(i.menuItemId, i.itemNameSnapshot, KRA_CODES.finishedProduct, typeOf(cat(i.menuItemId)), unitOf(i), i.quantity, dcRtOf(cat(i.menuItemId))));
  if (sale.serviceChargeAmount > 0) lines.push(line('SERVICE_CHARGE', 'Service charge', KRA_CODES.service, vatRegistered ? KRA_CODES.serviceChargeTax : 'D', sale.serviceChargeAmount, 1, 0));
  if (!lines.length) throw new KraError('EMPTY', 'Nothing on this bill to send', true);

  // Rounding leaves a few cents: put them on the last line. More than that means the bill doesn't match.
  const diff = money(target - lines.reduce((s, l) => s + l.totAmt, 0));
  if (Math.abs(diff) > 0.05 + 0.01 * lines.length) {
    throw new KraError('MISMATCH', `The invoice lines add up to KES ${money(target - diff)} but the bill is KES ${money(target)}: not sent`, true);
  }
  if (diff) {
    const l = lines[lines.length - 1];
    const r = rateOf(l.taxType);
    l.splyAmt = money(l.splyAmt + diff);
    l.taxblAmt = money(l.splyAmt - l.dcAmt);
    l.totAmt = l.taxblAmt;
    l.taxAmt = money((l.taxblAmt * r) / (100 + r));
  }
  return lines;
}

function totals(lines: EtimsLine[]) {
  const out: Record<string, number> = {};
  for (const t of ['A', 'B', 'C', 'D', 'E']) {
    const mine = lines.filter((l) => l.taxType === t);
    const taxbl = money(mine.reduce((s, l) => s + l.taxblAmt, 0));
    const tax = money(mine.reduce((s, l) => s + l.taxAmt, 0));
    out[`taxblAmt${t}`] = taxbl;
    out[`taxRt${t}`] = t === 'B' && taxbl - tax > 0 ? Math.round((tax / (taxbl - tax)) * 100) : KRA_CODES.taxRates[t];
    out[`taxAmt${t}`] = tax;
  }
  return {
    ...out,
    totTaxblAmt: money(lines.reduce((s, l) => s + l.taxblAmt, 0)),
    totTaxAmt: money(lines.reduce((s, l) => s + l.taxAmt, 0)),
    totAmt: money(lines.reduce((s, l) => s + l.totAmt, 0)),
  };
}

// ---------------------------------------------------------------------------
// Signing

const OPERATOR = { regrId: 'melio', regrNm: 'Melio POS', modrId: 'melio', modrNm: 'Melio POS' };
const LOCK_MS = 5 * 60_000;
const MAX_WAIT_MS = 60 * 60_000;
const MAX_INTERNAL_TRIES = 10;

async function ensureItems(device: { branchId: string; itemClassCode: string; environment: string }, auth: Auth, lines: EtimsLine[], timeoutMs: number) {
  const known = new Map((await prisma.etimsItem.findMany({ where: { branchId: device.branchId, itemKey: { in: lines.map((l) => l.itemKey) } } })).map((i) => [i.itemKey, i.itemCode]));
  for (const l of lines) {
    if (known.has(l.itemKey)) continue;
    const [row] = await prisma.$queryRaw<{ lastItemNo: number }[]>`
      UPDATE "etims_devices" SET "lastItemNo" = "lastItemNo" + 1, "updatedAt" = now() WHERE "branchId" = ${device.branchId} RETURNING "lastItemNo"`;
    const itemCd = `KE${l.itemType}${KRA_CODES.packagingUnit}${KRA_CODES.quantityUnit}${String(row.lastItemNo).padStart(7, '0')}`;
    try {
      await kraPost(device.environment as Env, '/saveItem', {
        itemCd, itemClsCd: device.itemClassCode, itemTyCd: l.itemType, itemNm: l.name, itemStdNm: null, orgnNatCd: 'KE',
        pkgUnitCd: KRA_CODES.packagingUnit, qtyUnitCd: KRA_CODES.quantityUnit, taxTyCd: l.taxType, btchNo: null, bcd: null,
        dftPrc: l.prc, grpPrcL1: null, grpPrcL2: null, grpPrcL3: null, grpPrcL4: null, grpPrcL5: null, addInfo: null, sftyQty: null,
        isrcAplcbYn: 'N', useYn: 'Y', ...OPERATOR,
      }, auth, timeoutMs);
    } catch (err) {
      if (!(err instanceof KraError && err.duplicate)) throw err;
    }
    await prisma.etimsItem.createMany({ data: [{ branchId: device.branchId, itemKey: l.itemKey, itemCode: itemCd }], skipDuplicates: true });
    known.set(l.itemKey, (await prisma.etimsItem.findUnique({ where: { branchId_itemKey: { branchId: device.branchId, itemKey: l.itemKey } } }))!.itemCode);
  }
  return known;
}

const paymentType = (methods: string[]) => {
  const set = [...new Set(methods)];
  return set.length === 1 ? KRA_CODES.payment[set[0]] || KRA_CODES.payment.OTHER : KRA_CODES.payment.OTHER;
};

type Outcome = 'signed' | 'waiting' | 'retry' | 'rejected' | 'busy';

/** Sends one invoice to KRA. Never throws: the outcome is saved on the invoice. */
async function signInvoice(id: string, timeoutMs = 20_000): Promise<Outcome> {
  const now = new Date();
  const myLock = new Date(now.getTime() + LOCK_MS);
  // Claim it, so two requests never send the same invoice at once.
  const claimed = await prisma.etimsInvoice.updateMany({
    where: { id, status: 'PENDING', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: myLock },
  });
  if (!claimed.count) return 'busy';
  const inv = (await prisma.etimsInvoice.findUnique({ where: { id } }))!;
  const wait = async (reason: string, ms: number): Promise<Outcome> => {
    await prisma.etimsInvoice.update({ where: { id }, data: { lockedUntil: null, nextTryAt: new Date(Date.now() + ms), lastError: reason } });
    return 'waiting';
  };
  try {
    const device = await prisma.etimsDevice.findUnique({ where: { branchId: inv.branchId } });
    if (!device) throw new KraError('NO_DEVICE', "This branch's eTIMS device was removed", true);
    const restaurant = (await prisma.restaurant.findUnique({ where: { id: inv.restaurantId }, select: { kraPin: true, name: true, legalName: true, vatRegistered: true } }))!;
    if (!restaurant.kraPin) throw new KraError('NO_PIN', "The business's KRA PIN was removed", true);
    const auth = { tin: restaurant.kraPin, bhfId: device.bhfId, cmcKey: device.cmcKey };
    const sale = (await prisma.sale.findUnique({
      where: { id: inv.saleId },
      include: { items: { include: { modifiers: true } }, payments: { where: { status: { in: ['COMPLETED', 'REFUNDED'] } }, select: { method: true } }, receipt: true, branch: { select: { address: true } } },
    }))!;

    let orgInvcNo = 0;
    let target = money(inv.amount ?? sale.totalAmount);
    if (inv.kind === 'CREDIT_NOTE') {
      const original = await latestSale(prisma, inv.saleId, inv.createdAt);
      if (!original || original.status === 'REJECTED' || original.status === 'DROPPED') throw new KraError('ORIGINAL_NOT_SIGNED', 'The bill it refunds was not signed by KRA', true);
      // The bill isn't signed yet: wait for it without counting a failed try.
      if (original.status !== 'SIGNED' || !original.invoiceNo) return wait('Waiting for the bill it refunds to be signed', 60_000);
      if (original.environment !== device.environment || original.bhfId !== device.bhfId) throw new KraError('OTHER_DEVICE', 'The bill was signed on a different KRA device', true);
      orgInvcNo = original.invoiceNo;
      // Never credit more than KRA has for this bill: its invoices minus earlier credit notes.
      const earlier = await prisma.etimsInvoice.findMany({ where: { saleId: inv.saleId, id: { not: id }, createdAt: { lt: inv.createdAt }, status: { in: ['PENDING', 'SIGNED'] } }, select: { kind: true, amount: true } });
      const net = earlier.reduce((t, i) => t + (i.kind === 'SALE' ? i.amount ?? sale.totalAmount : -(i.amount || 0)), 0);
      target = money(Math.min(inv.amount || 0, net));
      if (target <= 0) throw new KraError('NOTHING_LEFT', 'Nothing left to credit on this bill', true);
    }

    const categories = new Map((await prisma.menuItem.findMany({ where: { id: { in: sale.items.map((i) => i.menuItemId) } }, select: { id: true, taxCategory: true } })).map((m) => [m.id, m.taxCategory]));
    const lines = etimsLines(sale, (mid) => categories.get(mid) || 'STANDARD', restaurant.vatRegistered, target, sale.totalAmount > 0 ? target / sale.totalAmount : 0);
    const codes = await ensureItems(device, auth, lines, timeoutMs);

    // KRA numbers run 1, 2, 3 per branch: one unsigned number at a time, taken only when sending, kept for retries.
    const invoiceNo = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "etims_devices" WHERE "branchId" = ${device.branchId} FOR UPDATE`;
      const cur = (await tx.etimsInvoice.findUnique({ where: { id }, select: { invoiceNo: true, environment: true, bhfId: true } }))!;
      if (cur.invoiceNo && cur.environment === device.environment && cur.bhfId === device.bhfId) return cur.invoiceNo;
      const ahead = await tx.etimsInvoice.findFirst({ where: { branchId: device.branchId, id: { not: id }, status: 'PENDING', invoiceNo: { not: null }, environment: device.environment, bhfId: device.bhfId }, select: { id: true } });
      if (ahead) return null;
      const d = await tx.etimsDevice.update({ where: { branchId: device.branchId }, data: { lastInvoiceNo: { increment: 1 } } });
      await tx.etimsInvoice.update({ where: { id }, data: { invoiceNo: d.lastInvoiceNo, environment: d.environment, bhfId: d.bhfId } });
      return d.lastInvoiceNo;
    });
    if (invoiceNo === null) return wait('Waiting for an earlier invoice to be signed first', 30_000);
    // Still ours? (A very slow send may have been taken over.)
    if ((await prisma.etimsInvoice.findUnique({ where: { id }, select: { lockedUntil: true } }))?.lockedUntil?.getTime() !== myLock.getTime()) return 'busy';

    const confirmedAt = inv.kind === 'SALE' ? sale.receipt?.issuedAt || sale.updatedAt : inv.createdAt;
    const data = await kraPost(device.environment as Env, '/saveTrnsSalesOsdc', {
      trdInvcNo: (inv.kind === 'SALE' ? sale.receipt?.receiptNumber || sale.orderNumber : inv.reference || `REF-${sale.orderNumber}`).slice(0, 50),
      invcNo: invoiceNo,
      orgInvcNo,
      custTin: null,
      custNm: sale.customerName?.slice(0, 60) || null,
      salesTyCd: 'N',
      rcptTyCd: inv.kind === 'SALE' ? 'S' : 'R',
      pmtTyCd: paymentType(sale.payments.map((p) => p.method)),
      salesSttsCd: '02',
      cfmDt: kraTime(confirmedAt),
      salesDt: kraDate(confirmedAt),
      stockRlsDt: null,
      cnclReqDt: null,
      cnclDt: null,
      rfdDt: inv.kind === 'SALE' ? null : kraTime(inv.createdAt),
      rfdRsnCd: inv.kind === 'SALE' ? null : KRA_CODES.refundReason,
      totItemCnt: lines.length,
      ...totals(lines),
      prchrAcptcYn: 'N',
      remark: null,
      ...OPERATOR,
      receipt: {
        custTin: null, custMblNo: null, rcptPbctDt: kraTime(new Date()),
        trdeNm: (restaurant.legalName || restaurant.name).slice(0, 20), adrs: sale.branch?.address?.slice(0, 200) || null,
        topMsg: null, btmMsg: 'Thank you', prchrAcptcYn: 'N',
      },
      itemList: lines.map((l, i) => ({
        itemSeq: i + 1, itemCd: codes.get(l.itemKey), itemClsCd: device.itemClassCode, itemNm: l.name, bcd: null,
        pkgUnitCd: KRA_CODES.packagingUnit, pkg: l.qty, qtyUnitCd: KRA_CODES.quantityUnit, qty: l.qty, prc: l.prc,
        splyAmt: l.splyAmt, dcRt: l.dcRt, dcAmt: l.dcAmt, isrccCd: null, isrccNm: null, isrcRt: null, isrcAmt: null,
        taxTyCd: l.taxType, taxblAmt: l.taxblAmt, taxAmt: l.taxAmt, totAmt: l.totAmt,
      })),
    }, auth, timeoutMs);
    await prisma.etimsInvoice.update({
      where: { id },
      data: {
        status: 'SIGNED', signedAt: new Date(), lockedUntil: null, lastError: null, attempts: { increment: 1 },
        curRcptNo: Number(data.curRcptNo) || null, totRcptNo: Number(data.totRcptNo) || null,
        intrlData: data.intrlData ? String(data.intrlData) : null, rcptSign: data.rcptSign ? String(data.rcptSign) : null,
        sdcDateTime: data.sdcDateTime ? String(data.sdcDateTime) : null,
      },
    });
    return 'signed';
  } catch (err: any) {
    const e = err instanceof KraError ? err : new KraError('INTERNAL', err?.message || 'Unexpected error', false);
    if (e.duplicate) {
      // Sent before, answer lost: KRA has it, but its signature can only be looked up on KRA's portal.
      await prisma.etimsInvoice.update({ where: { id }, data: { status: 'SIGNED', signedAt: new Date(), lockedUntil: null, lastError: 'KRA already had this invoice; signature not returned' } });
      return 'signed';
    }
    const attempts = inv.attempts + 1;
    const reject = e.permanent || (e.code === 'INTERNAL' && attempts >= MAX_INTERNAL_TRIES);
    await prisma.$transaction(async (tx) => {
      if (reject) {
        // KRA never recorded its number: give it back so the next invoice uses it (no gap).
        const cur = await tx.etimsInvoice.findUnique({ where: { id }, select: { invoiceNo: true, environment: true, bhfId: true } });
        if (cur?.invoiceNo) {
          await tx.$executeRaw`UPDATE "etims_devices" SET "lastInvoiceNo" = "lastInvoiceNo" - 1 WHERE "branchId" = ${inv.branchId} AND "lastInvoiceNo" = ${cur.invoiceNo} AND "environment" = ${cur.environment} AND "bhfId" = ${cur.bhfId}`;
        }
      }
      await tx.etimsInvoice.update({
        where: { id },
        data: reject
          ? { status: 'REJECTED', attempts, lastError: e.message.slice(0, 500), lockedUntil: null, invoiceNo: null, environment: null, bhfId: null }
          : { attempts, lastError: e.message.slice(0, 500), lockedUntil: null, nextTryAt: new Date(Date.now() + Math.min(MAX_WAIT_MS, 60_000 * 2 ** Math.min(attempts, 6))) },
      });
    });
    if (reject) {
      notifyRestaurantStaff(inv.restaurantId, inv.branchId, 'ETIMS_REJECTED', 'Invoice not signed by KRA', `${inv.kind === 'SALE' ? 'A receipt' : 'A refund'} was not signed by KRA: ${e.message}. See Settings, KRA eTIMS.`, 'Sale', inv.saleId).catch(() => undefined);
      return 'rejected';
    }
    return 'retry';
  }
}

/** Sends invoices that are due (oldest first); stops when KRA can't be reached. Cheap when none are due. */
export async function signPendingEtims(restaurantId: string, branchId?: string | null, limit = 10, timeoutMs?: number) {
  const due = await prisma.etimsInvoice.findMany({
    where: { restaurantId, ...(branchId ? { branchId } : {}), status: 'PENDING', nextTryAt: { lte: new Date() } },
    orderBy: [{ invoiceNo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  });
  let tried = 0;
  for (const d of due) {
    tried++;
    if ((await signInvoice(d.id, timeoutMs)) === 'retry') break;
  }
  return tried;
}

/** Signs a bill's receipt right away when it is printed (short wait), if it is still waiting. */
export async function signSaleNow(saleId: string) {
  const inv = await latestSale(prisma, saleId);
  if (inv?.status !== 'PENDING') return;
  if ((await signInvoice(inv.id, 6_000)) !== 'busy') return;
  // Another request is sending it right now (e.g. just after the payment): wait briefly for its answer.
  const until = Date.now() + 6_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 300));
    const now = await prisma.etimsInvoice.findUnique({ where: { id: inv.id }, select: { status: true, lockedUntil: true } });
    if (now?.status !== 'PENDING' || !now.lockedUntil || now.lockedUntil < new Date()) return;
  }
}

/** What the receipt shows: KRA's numbers and QR code once signed, marked as a test on anything but the live system. */
export async function etimsReceiptInfo(saleId: string) {
  const inv = await latestSale(prisma, saleId);
  if (!inv) return null;
  const device = await prisma.etimsDevice.findUnique({ where: { branchId: inv.branchId }, select: { sdcId: true, mrcNo: true, environment: true } });
  const restaurant = await prisma.restaurant.findUnique({ where: { id: inv.restaurantId }, select: { kraPin: true } });
  // The environment that signed it, not the device's current one.
  const env = inv.environment || device?.environment || 'test';
  const qrUrl = inv.status === 'SIGNED' && inv.rcptSign && restaurant?.kraPin && inv.bhfId
    ? `${RECEIPT_PAGE[env === 'production' ? 'production' : 'sandbox']}?Data=${encodeURIComponent(`${restaurant.kraPin}${inv.bhfId}${inv.rcptSign}`)}`
    : null;
  const sameDevice = device && device.environment === inv.environment;
  return {
    status: inv.status,
    testOnly: env !== 'production',
    invoiceNo: inv.invoiceNo,
    cuInvoiceNo: sameDevice && device.sdcId && inv.curRcptNo ? `${device.sdcId}/${inv.curRcptNo}` : null,
    sdcId: sameDevice ? device.sdcId : null,
    mrcNo: sameDevice ? device.mrcNo : null,
    intrlData: inv.intrlData,
    rcptSign: inv.rcptSign,
    signedAt: inv.signedAt,
    qrUrl,
    qrSvg: qrUrl ? await QRCode.toString(qrUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) : null,
  };
}
