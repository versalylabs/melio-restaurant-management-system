import { Prisma } from '@prisma/client';
import { queueEtimsCredit } from './etimsService';
import prisma from '../config/database';
import { getRestaurantTimeZone, localDayRange, zonedParts } from '../utils/timezone';

type Tx = Prisma.TransactionClient;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Issues a credit note for a refund: CN-000001, CN-000002 … per restaurant,
 * with the VAT part in the same proportion as on the original bill. Credit
 * notes reverse the sale in the tax summary (VAT and Tourism Levy base).
 */
export async function issueCreditNote(
  tx: Tx,
  input: { restaurantId: string; branchId: string; saleId: string; paymentId: string; amount: number; reason: string; createdBy: string }
) {
  const sale = await tx.sale.findUnique({ where: { id: input.saleId }, select: { totalAmount: true, taxAmount: true } });
  const vatAmount = sale && sale.totalAmount > 0 ? round2((input.amount * sale.taxAmount) / sale.totalAmount) : 0;
  // Atomic insert-or-increment (row lock), so two refunds never get the same number,
  // even for a restaurant's very first credit notes.
  const [counter] = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "credit_note_counters" ("restaurantId", "lastNumber") VALUES (${input.restaurantId}, 1)
    ON CONFLICT ("restaurantId") DO UPDATE SET "lastNumber" = "credit_note_counters"."lastNumber" + 1
    RETURNING "lastNumber"`;
  const note = await tx.creditNote.create({
    data: {
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      saleId: input.saleId,
      paymentId: input.paymentId,
      number: `CN-${String(counter.lastNumber).padStart(6, '0')}`,
      amount: round2(input.amount),
      vatAmount,
      reason: input.reason,
      createdBy: input.createdBy,
    },
  });
  await queueEtimsCredit(tx, { restaurantId: note.restaurantId, branchId: note.branchId, saleId: note.saleId, amount: note.amount, key: `C:${note.id}`, reference: note.number, creditNoteId: note.id });
  return note;
}

/** "2026-11" → first and last day of that month in the restaurant's time zone. */
function monthRange(month: string, timeZone: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const first = localDayRange(`${m[1]}-${m[2]}-01`, timeZone);
  const last = localDayRange(`${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`, timeZone);
  if (!first || !last) return null;
  const due = new Date(Date.UTC(mon === 12 ? year + 1 : year, mon === 12 ? 0 : mon, 10));
  return { start: first.start, end: last.end, dueDate: due.toISOString().slice(0, 10) };
}

/**
 * Monthly tax summary for the accountant: VAT by category, credit notes,
 * service charge and the Tourism Levy, with a line per day.
 *
 * Sales count in the month they were closed (COMPLETED, by completion date).
 * Bills from before VAT categories were recorded have no category; they are
 * shown on their own line rather than guessed.
 */
export async function buildTaxSummary(restaurantId: string, month: string, branchId?: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, legalName: true, kraPin: true, vatRegistered: true, pricesIncludeTax: true, taxRate: true, tourismLevyRate: true, serviceChargeRate: true },
  });
  if (!restaurant) return null;
  const timeZone = await getRestaurantTimeZone(restaurantId);
  const range = monthRange(month, timeZone);
  if (!range) return null;
  const branch = branchId ? { branchId } : {};

  const [sales, creditNotes] = await Promise.all([
    prisma.sale.findMany({
      where: { restaurantId, ...branch, status: 'COMPLETED', completedAt: { gte: range.start, lte: range.end } },
      select: {
        id: true, completedAt: true, subtotal: true, discountAmount: true, taxAmount: true, serviceChargeAmount: true, totalAmount: true,
        taxableAmount: true, zeroRatedAmount: true, exemptAmount: true, taxInclusive: true,
      },
    }),
    prisma.creditNote.findMany({
      where: { restaurantId, ...branch, createdAt: { gte: range.start, lte: range.end } },
      select: {
        number: true, amount: true, vatAmount: true, reason: true, createdAt: true, saleId: true,
        sale: { select: { orderNumber: true, totalAmount: true, payments: { where: { status: 'COMPLETED' }, select: { amount: true } }, creditNotes: { select: { amount: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // A refund that was later paid again (e.g. cash re-taken as M-Pesa) didn't reverse
  // the sale: only the part of a sale's credit notes not covered by later payments counts.
  const counted = creditNotes.map((c) => {
    const notes = c.sale.creditNotes.reduce((t, n) => t + n.amount, 0);
    const paid = c.sale.payments.reduce((t, p) => t + p.amount, 0);
    const reversed = Math.max(0, Math.min(notes, c.sale.totalAmount - paid));
    const factor = notes > 0 ? reversed / notes : 0;
    return { ...c, countedAmount: round2(c.amount * factor), countedVat: round2(c.vatAmount * factor) };
  });

  const dayKey = (d: Date) => {
    const p = zonedParts(d, timeZone);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  };
  type Day = { date: string; bills: number; grossSales: number; standardRated: number; vat: number; zeroRated: number; exempt: number; noCategory: number; serviceCharge: number; discounts: number; creditNotes: number; creditNoteVat: number };
  const days = new Map<string, Day>();
  const day = (key: string): Day => {
    let d = days.get(key);
    if (!d) {
      d = { date: key, bills: 0, grossSales: 0, standardRated: 0, vat: 0, zeroRated: 0, exempt: 0, noCategory: 0, serviceCharge: 0, discounts: 0, creditNotes: 0, creditNoteVat: 0 };
      days.set(key, d);
    }
    return d;
  };

  for (const s of sales) {
    const d = day(dayKey(s.completedAt!));
    const netOfVat = s.subtotal - s.discountAmount - (s.taxInclusive ? s.taxAmount : 0);
    const categorised = s.taxableAmount + s.zeroRatedAmount + s.exemptAmount;
    d.bills += 1;
    d.grossSales += s.totalAmount;
    d.standardRated += s.taxableAmount;
    d.vat += s.taxAmount;
    d.zeroRated += s.zeroRatedAmount;
    d.exempt += s.exemptAmount;
    // Rounding leaves a cent or two on newer bills; only real gaps are older uncategorised bills.
    const gap = netOfVat - categorised;
    if (gap > 0.05) d.noCategory += gap;
    d.serviceCharge += s.serviceChargeAmount;
    d.discounts += s.discountAmount;
  }
  for (const c of counted) {
    const d = day(dayKey(c.createdAt));
    d.creditNotes += c.countedAmount;
    d.creditNoteVat += c.countedVat;
  }

  const rows = [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'number' && k !== 'bills' ? round2(v) : v])) as Day);
  const total = (k: keyof Day) => round2(rows.reduce((t, r) => t + (r[k] as number), 0));

  const outputVat = total('vat');
  const creditNoteVat = total('creditNoteVat');
  // Tourism Levy: on gross sales excluding VAT, less refunds (excluding their VAT).
  const levyBase = round2(total('grossSales') - outputVat - (total('creditNotes') - creditNoteVat));
  const levyRate = restaurant.tourismLevyRate || 0;

  return {
    month,
    period: { start: range.start, end: range.end, timeZone },
    business: {
      name: restaurant.legalName || restaurant.name,
      kraPin: restaurant.kraPin,
      vatRegistered: restaurant.vatRegistered,
      vatRate: restaurant.taxRate > 1 ? restaurant.taxRate / 100 : restaurant.taxRate,
      pricesIncludeTax: restaurant.pricesIncludeTax,
    },
    totals: {
      bills: rows.reduce((t, r) => t + r.bills, 0),
      grossSales: total('grossSales'),
      discounts: total('discounts'),
      standardRated: total('standardRated'),
      outputVat,
      zeroRated: total('zeroRated'),
      exempt: total('exempt'),
      noCategory: total('noCategory'),
      serviceCharge: total('serviceCharge'),
      creditNotes: total('creditNotes'),
      creditNoteVat,
      netVat: round2(outputVat - creditNoteVat),
    },
    tourismLevy: {
      rate: levyRate,
      base: Math.max(0, levyBase),
      due: round2(Math.max(0, levyBase) * levyRate),
      dueDate: range.dueDate,
    },
    days: rows,
    creditNoteList: counted.map((c) => ({
      number: c.number, orderNumber: c.sale.orderNumber, amount: c.amount, vatAmount: c.vatAmount,
      countedAmount: c.countedAmount, countedVat: c.countedVat, reason: c.reason, createdAt: c.createdAt,
    })),
  };
}

const csvCell = (v: unknown) => {
  if (typeof v === 'number') return String(v); // numbers stay numbers, negatives included
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** The same summary as a CSV the accountant can open in Excel. */
export function taxSummaryCsv(summary: NonNullable<Awaited<ReturnType<typeof buildTaxSummary>>>) {
  const lines: string[] = [];
  const row = (...cells: unknown[]) => lines.push(cells.map(csvCell).join(','));
  row('Tax summary', summary.business.name, `KRA PIN ${summary.business.kraPin || 'not set'}`, `Month ${summary.month}`);
  row('Prices', summary.business.pricesIncludeTax ? 'include VAT' : 'VAT added on top', 'VAT rate', `${round2(summary.business.vatRate * 100)}%`);
  row('');
  row('Date', 'Bills', 'Gross sales', 'Standard-rated (excl. VAT)', 'Output VAT', 'Zero-rated', 'Exempt', 'No VAT category (older bills)', 'Service charge', 'Discounts', 'Credit notes', 'Credit note VAT');
  for (const d of summary.days) {
    row(d.date, d.bills, d.grossSales, d.standardRated, d.vat, d.zeroRated, d.exempt, d.noCategory, d.serviceCharge, d.discounts, d.creditNotes, d.creditNoteVat);
  }
  const t = summary.totals;
  row('Total', t.bills, t.grossSales, t.standardRated, t.outputVat, t.zeroRated, t.exempt, t.noCategory, t.serviceCharge, t.discounts, t.creditNotes, t.creditNoteVat);
  row('');
  row('Net VAT (output less credit notes)', t.netVat);
  row('Tourism Levy base', summary.tourismLevy.base, 'Rate', `${round2(summary.tourismLevy.rate * 100)}%`, 'Due', summary.tourismLevy.due, 'By', summary.tourismLevy.dueDate);
  row('');
  row('Credit note', 'Order', 'Amount', 'VAT', 'Counted (not re-paid)', 'VAT counted', 'Reason', 'Date');
  for (const c of summary.creditNoteList) row(c.number, c.orderNumber, c.amount, c.vatAmount, c.countedAmount, c.countedVat, c.reason, new Date(c.createdAt).toISOString().slice(0, 10));
  row('');
  row('Prepared by Melio from recorded sales. This is not an eTIMS invoice or a KRA return; check it before filing.');
  return lines.join('\r\n');
}
