import prisma from '../config/database';
import { createAuditLog } from './auditLogService';

/**
 * Checks an M-Pesa till statement against the payments recorded in Melio:
 * which money arrived and was recorded, which "M-Pesa to check" payments it
 * confirms, which money arrived with nothing recorded, and which M-Pesa codes
 * were recorded in Melio but are not on the statement (the fake-message risk).
 *
 * shortcut: CSV only (from the M-Pesa business portal, or Excel "Save as CSV"); add .xlsx if staff struggle with it.
 * shortcut: reversals are not read (a reversed payment still shows as received); add when we have a real export with reversal lines.
 */

const normaliseMpesaCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const CODE = /^[A-Z0-9]{10}$/;

export type StatementLine = { receipt: string; time: Date; amount: number; from: string };

/** Splits CSV text into rows, honouring quotes. The separator is whichever of , ; or tab the header uses most. */
function csvRows(text: string): string[][] {
  const headerLine = text.split(/\r?\n/).find((l) => /receipt/i.test(l)) || '';
  const sep = [',', ';', '\t'].map((d) => [d, headerLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.trim()));
}

/**
 * "24/11/2026 14:02:11", "24-11-2026 02:02:11 PM" or "2026-11-24 14:02:11", in
 * Nairobi time. Day comes before month, as the M-Pesa portal writes it.
 * Null when it can't be read for certain.
 */
export function parseStatementTime(raw: string): Date | null {
  const s = raw.trim();
  let y: string, mo: string, d: string;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) [y, mo, d] = [m[1], m[2], m[3]];
  else {
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return null;
    [d, mo, y] = [m[1], m[2], m[3]];
  }
  let hour = Number(m[4]);
  if (m[7]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0);
  }
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || hour > 23) return null;
  const pad = (v: string | number) => String(v).padStart(2, '0');
  const t = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(hour)}:${m[5]}:${m[6] || '00'}+03:00`);
  // Rejects impossible dates such as 31/02 (JavaScript would roll them into March).
  return t.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) === `${y}-${pad(mo)}-${pad(d)}` ? t : null;
}

/** "1,250.00" → 1250; "(500.00)" → -500. */
const money = (v: string) => {
  const s = String(v || '').trim();
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return /^\(.*\)$/.test(s) ? -Math.abs(n) : n;
};

/**
 * The money received in a statement (completed "paid in" lines), plus every
 * receipt code in the file. An error when it isn't a statement or a received
 * line's time can't be read (better than silently leaving it out).
 */
export function parseStatement(text: string): { lines: StatementLine[]; allReceipts: Set<string> } | { error: string } {
  const rows = csvRows(text.replace(/^﻿/, ''));
  const headerAt = rows.findIndex((r) => r.some((c) => /receipt/i.test(c)) && r.some((c) => /paid\s*in/i.test(c)));
  if (headerAt < 0) return { error: 'This doesn\'t look like an M-Pesa statement. It needs the "Receipt No." and "Paid In" columns (download it as CSV from the M-Pesa business portal).' };
  const head = rows[headerAt].map((h) => h.toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const c = {
    receipt: col(/receipt/), time: col(/completion/) >= 0 ? col(/completion/) : col(/time|date/), paidIn: col(/paid\s*in/),
    status: col(/status/), from: col(/other party|party info/),
  };
  if (c.time < 0) return { error: 'The statement needs a "Completion Time" column.' };
  const lines: StatementLine[] = [];
  const allReceipts = new Set<string>();
  for (const [i, r] of rows.slice(headerAt + 1).entries()) {
    const receipt = normaliseMpesaCode(r[c.receipt]);
    if (!CODE.test(receipt)) continue;
    // Every code on the statement, whatever its status: none of them may be called "not on the statement".
    allReceipts.add(receipt);
    const amount = money(r[c.paidIn]);
    if (amount <= 0) continue;
    if (c.status >= 0 && r[c.status] && !/^completed?$/i.test(r[c.status])) continue;
    const time = parseStatementTime(r[c.time] || '');
    if (!time) return { error: `Row ${headerAt + i + 2} (${receipt}): the time "${r[c.time] || ''}" can't be read. Download the CSV straight from the M-Pesa portal rather than re-saving it in Excel.` };
    if (!lines.some((l) => l.receipt === receipt)) lines.push({ receipt, time, amount, from: c.from >= 0 ? r[c.from] || '' : '' });
  }
  if (!lines.length) return { error: 'No money received was found in this statement.' };
  return { lines, allReceipts };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const HOUR = 60 * 60 * 1000;

/**
 * Matches a parsed statement to one branch's payments. "M-Pesa to check"
 * payments carrying a code the statement proves are confirmed, except the
 * uploader's own (another manager confirms those, as with the manual check).
 */
export async function checkStatement(restaurantId: string, branchId: string, parsed: { lines: StatementLine[]; allReceipts: Set<string> }, userId: string) {
  const { lines, allReceipts } = parsed;
  const codes = [...new Set(lines.map((l) => l.receipt))];
  const from = new Date(Math.min(...lines.map((l) => l.time.getTime())));
  const to = new Date(Math.max(...lines.map((l) => l.time.getTime())));
  const sale = { select: { id: true, orderNumber: true } };

  // Codes are stored upper-case and plain, so an exact match uses the index; in chunks to stay within query limits.
  const byCode = new Map<string, Array<{ id: string; reference: string | null; amount: number; status: string; verifyStatus: string | null; createdBy: string; branchId: string; sale: { id: string; orderNumber: string } }>>();
  for (let i = 0; i < codes.length; i += 5000) {
    const found = await prisma.payment.findMany({
      where: { restaurantId, method: 'MOBILE_MONEY', reference: { in: codes.slice(i, i + 5000) } },
      select: { id: true, reference: true, amount: true, status: true, verifyStatus: true, createdBy: true, branchId: true, sale },
    });
    for (const p of found) byCode.set(p.reference!, [...(byCode.get(p.reference!) || []), p]);
  }
  const unchecked = await prisma.payment.findMany({
    where: { restaurantId, branchId, method: 'MOBILE_MONEY', status: 'COMPLETED', verifyStatus: 'PENDING_CHECK', reference: null },
    select: { id: true, amount: true, createdAt: true, sale },
  });
  // Each unchecked payment is offered only on its closest statement line of the same amount.
  const closest = new Map<string, string>();
  for (const p of unchecked) {
    let best: StatementLine | null = null;
    for (const l of lines) {
      if (!near(p.amount, l.amount) || byCode.has(l.receipt)) continue;
      const gap = Math.abs(p.createdAt.getTime() - l.time.getTime());
      if (gap <= 12 * HOUR && (!best || gap < Math.abs(p.createdAt.getTime() - best.time.getTime()))) best = l;
    }
    if (best) closest.set(p.id, best.receipt);
  }

  const rows: Array<StatementLine & { result: string; [k: string]: unknown }> = [];
  let matched = 0;
  let confirmed = 0;
  for (const l of lines) {
    const found = byCode.get(l.receipt) || [];
    const live = found.find((p) => ['COMPLETED', 'REFUNDED', 'DUPLICATE'].includes(p.status));
    if (live) {
      if (live.verifyStatus === 'PENDING_CHECK' && live.status === 'COMPLETED' && near(live.amount, l.amount)) {
        if (live.createdBy === userId || live.branchId !== branchId) {
          rows.push({ ...l, result: 'NEEDS_OTHER_MANAGER', order: live.sale, paymentId: live.id });
          continue;
        }
        const done = await prisma.payment.updateMany({ where: { id: live.id, verifyStatus: 'PENDING_CHECK', status: 'COMPLETED' }, data: { verifyStatus: 'CONFIRMED', verifiedBy: userId, verifiedAt: new Date() } });
        if (done.count) {
          confirmed++;
          await createAuditLog(restaurantId, userId, 'UPDATE', 'Payment', live.id, `M-Pesa statement proves ${l.receipt} (KES ${l.amount}): confirmed`);
        }
        continue;
      }
      if (near(live.amount, l.amount)) { matched++; continue; }
      rows.push({ ...l, result: 'AMOUNT_DIFFERS', recordedAmount: live.amount, order: live.sale });
      continue;
    }
    const cancelled = found.find((p) => p.verifyStatus === 'NOT_RECEIVED');
    if (cancelled) {
      rows.push({ ...l, result: 'WAS_MARKED_NOT_RECEIVED', order: cancelled.sale, paymentId: cancelled.id });
      continue;
    }
    const candidates = unchecked
      .filter((p) => closest.get(p.id) === l.receipt)
      .map((p) => ({ paymentId: p.id, amount: p.amount, createdAt: p.createdAt, order: p.sale }));
    rows.push({ ...l, result: candidates.length ? 'POSSIBLE_MATCH' : 'NOT_IN_MELIO', candidates });
  }

  // M-Pesa codes typed in at this branch's till during the statement's period that the statement doesn't have.
  const recorded = await prisma.payment.findMany({
    where: {
      restaurantId, branchId, method: 'MOBILE_MONEY', status: { in: ['COMPLETED', 'REFUNDED'] },
      createdAt: { gte: from, lte: to },
      reference: { not: null },
      // Codes typed in by hand only: prompt payments were confirmed by Safaricom itself (and may go to another paybill).
      OR: [{ notes: null }, { NOT: { notes: { contains: 'CheckoutRequestID' } } }],
    },
    select: { id: true, reference: true, amount: true, createdAt: true, createdBy: true, sale },
  });
  const missing = recorded.filter((p) => CODE.test((p.reference || '').toUpperCase()) && !allReceipts.has((p.reference || '').toUpperCase()));
  const staffIds = [...new Set(missing.map((p) => p.createdBy))];
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds }, restaurantId }, select: { id: true, firstName: true, lastName: true } }) : [];
  const name = new Map(staff.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  const count = (r: string) => rows.filter((x) => x.result === r).length;
  return {
    period: { from, to },
    summary: {
      lines: lines.length,
      received: Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100,
      matched,
      confirmedNow: confirmed,
      possible: count('POSSIBLE_MATCH'),
      notInMelio: count('NOT_IN_MELIO'),
      amountDiffers: count('AMOUNT_DIFFERS'),
      missingFromStatement: missing.length,
    },
    // Only what needs a look; matched and confirmed lines are counted above.
    rows,
    missingFromStatement: missing.map((p) => ({ paymentId: p.id, reference: p.reference, amount: p.amount, createdAt: p.createdAt, order: p.sale, takenBy: name.get(p.createdBy) || null })),
  };
}
