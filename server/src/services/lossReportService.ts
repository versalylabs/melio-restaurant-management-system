import prisma from '../config/database';
import { getRestaurantTimeZone } from '../utils/timezone';
import { rangeDates } from './reportService';

/** An order the kitchen got that still isn't fully paid this long afterwards is flagged. */
export const UNPAID_AFTER_HOURS = 4;
const FIRED_STATUSES = ['SUBMITTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'SERVED', 'COMPLETED'];

const round2 = (n: number) => Math.round(n * 100) / 100;

interface StaffRow {
  userId: string;
  name: string;
  role: string;
  voids: { count: number; value: number };
  cancels: { count: number; value: number };
  discounts: { count: number; value: number };
  refunds: { count: number; value: number };
  mpesaNotReceived: { count: number; value: number };
  approvals: { count: number; value: number };
  shifts: { closed: number; shortage: number; over: number };
}

/**
 * Loss prevention report: who removed items or cancelled orders after the
 * kitchen had them, who gave discounts and refunds and which manager
 * approved them, which shifts came up short, and which orders reached the
 * kitchen but were never fully paid.
 */
export async function buildLossReport(restaurantId: string, options: { startDate?: string; endDate?: string; branchId?: string } = {}) {
  const timeZone = await getRestaurantTimeZone(restaurantId);
  const { start, end } = rangeDates(options.startDate, options.endDate, timeZone);
  const branch = options.branchId ? { branchId: options.branchId } : {};
  const inRange = { gte: start, lte: end };

  const [voids, discounted, refunds, shifts, unpaid, mpesaMissing, mpesaToCheck] = await Promise.all([
    prisma.voidRecord.findMany({ where: { restaurantId, ...branch, createdAt: inRange }, orderBy: { createdAt: 'desc' } }),
    prisma.sale.findMany({
      // Only orders that went ahead: not cancelled, and not still a draft or held.
      where: { restaurantId, ...branch, createdAt: inRange, discountAmount: { gt: 0 }, promotionId: null, status: { notIn: ['CANCELLED', 'DRAFT', 'HELD'] } },
      select: { id: true, orderNumber: true, discountAmount: true, discountReason: true, discountAppliedBy: true, discountApprovedBy: true, subtotal: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.findMany({
      where: { restaurantId, ...branch, status: 'REFUNDED', refundedAt: inRange },
      select: { id: true, amount: true, method: true, refundReason: true, refundedBy: true, refundApprovedBy: true, refundedAt: true, createdBy: true, sale: { select: { orderNumber: true } } },
      orderBy: { refundedAt: 'desc' },
    }),
    prisma.shift.findMany({
      where: { restaurantId, ...branch, status: 'CLOSED', closedAt: inRange },
      select: { id: true, userId: true, closedAt: true, cashVariance: true, mobileMoneyVariance: true, cardVariance: true },
    }),
    prisma.sale.findMany({
      where: {
        restaurantId,
        ...branch,
        createdAt: { gte: start, lte: new Date(Math.min(end.getTime(), Date.now() - UNPAID_AFTER_HOURS * 3_600_000)) },
        status: { in: FIRED_STATUSES },
        paymentStatus: { not: 'PAID' },
        // A refunded order is reported under refunds, not as unpaid.
        payments: { none: { status: 'REFUNDED' } },
      },
      select: { id: true, orderNumber: true, status: true, totalAmount: true, amountPaid: true, createdBy: true, servedBy: true, createdAt: true, table: { select: { tableNumber: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }).then((rows) => rows.filter((u) => u.totalAmount - u.amountPaid > 0.005)),
    prisma.payment.findMany({
      where: { restaurantId, ...branch, verifyStatus: 'NOT_RECEIVED', verifiedAt: inRange },
      select: { amount: true, createdBy: true },
    }),
    prisma.payment.aggregate({ where: { restaurantId, ...branch, verifyStatus: 'PENDING_CHECK', status: 'COMPLETED' }, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const userIds = new Set<string>();
  voids.forEach((v) => { userIds.add(v.requestedBy); if (v.approvedBy) userIds.add(v.approvedBy); });
  discounted.forEach((d) => { if (d.discountAppliedBy) userIds.add(d.discountAppliedBy); if (d.discountApprovedBy) userIds.add(d.discountApprovedBy); });
  refunds.forEach((r) => { if (r.refundedBy) userIds.add(r.refundedBy); if (r.refundApprovedBy) userIds.add(r.refundApprovedBy); });
  shifts.forEach((s) => userIds.add(s.userId));
  unpaid.forEach((u) => { userIds.add(u.createdBy); if (u.servedBy) userIds.add(u.servedBy); });

  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...userIds] }, restaurantId },
        select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, { name: `${u.firstName} ${u.lastName}`.trim(), role: u.role.name }]));
  const nameOf = (id?: string | null) => (id ? userById.get(id)?.name || 'Former staff member' : null);

  const staff = new Map<string, StaffRow>();
  const row = (id: string): StaffRow => {
    let r = staff.get(id);
    if (!r) {
      const u = userById.get(id);
      r = {
        userId: id,
        name: u?.name || 'Former staff member',
        role: u?.role || '',
        voids: { count: 0, value: 0 },
        cancels: { count: 0, value: 0 },
        discounts: { count: 0, value: 0 },
        refunds: { count: 0, value: 0 },
        mpesaNotReceived: { count: 0, value: 0 },
        approvals: { count: 0, value: 0 },
        shifts: { closed: 0, shortage: 0, over: 0 },
      };
      staff.set(id, r);
    }
    return r;
  };
  const add = (bucket: { count: number; value: number }, value: number) => {
    bucket.count += 1;
    bucket.value = round2(bucket.value + value);
  };

  for (const v of voids) {
    add(v.kind === 'ORDER' ? row(v.requestedBy).cancels : row(v.requestedBy).voids, v.value);
    if (v.approvedBy) add(row(v.approvedBy).approvals, v.value);
  }
  for (const d of discounted) {
    if (d.discountAppliedBy) add(row(d.discountAppliedBy).discounts, d.discountAmount);
    if (d.discountApprovedBy) add(row(d.discountApprovedBy).approvals, d.discountAmount);
  }
  for (const r of refunds) {
    // Refunds made before this report existed don't say who made them.
    if (r.refundedBy) add(row(r.refundedBy).refunds, r.amount);
    if (r.refundApprovedBy) add(row(r.refundApprovedBy).approvals, r.amount);
  }
  for (const m of mpesaMissing) add(row(m.createdBy).mpesaNotReceived, m.amount);
  for (const s of shifts) {
    const r = row(s.userId);
    r.shifts.closed += 1;
    for (const v of [s.cashVariance, s.mobileMoneyVariance, s.cardVariance]) {
      if (v == null) continue;
      if (v < 0) r.shifts.shortage = round2(r.shifts.shortage + -v);
      else r.shifts.over = round2(r.shifts.over + v);
    }
  }

  const sum = (rows: { value: number }[]) => round2(rows.reduce((t, r) => t + r.value, 0));
  const itemVoids = voids.filter((v) => v.kind === 'ITEM');
  const orderCancels = voids.filter((v) => v.kind === 'ORDER');
  const unpaidBalance = round2(unpaid.reduce((t, u) => t + (u.totalAmount - u.amountPaid), 0));

  // Most money at risk first.
  const risk = (r: StaffRow) => r.voids.value + r.cancels.value + r.discounts.value + r.refunds.value + r.mpesaNotReceived.value + r.shifts.shortage;

  return {
    range: { start, end, timeZone },
    unpaidAfterHours: UNPAID_AFTER_HOURS,
    summary: {
      itemVoids: { count: itemVoids.length, value: sum(itemVoids) },
      orderCancels: { count: orderCancels.length, value: sum(orderCancels) },
      discounts: { count: discounted.length, value: round2(discounted.reduce((t, d) => t + d.discountAmount, 0)) },
      refunds: { count: refunds.length, value: round2(refunds.reduce((t, r) => t + r.amount, 0)) },
      shiftShortage: round2([...staff.values()].reduce((t, r) => t + r.shifts.shortage, 0)),
      unpaid: { count: unpaid.length, value: unpaidBalance },
      mpesaNotReceived: { count: mpesaMissing.length, value: round2(mpesaMissing.reduce((t, m) => t + m.amount, 0)) },
      mpesaToCheck: { count: mpesaToCheck._count._all, value: round2(mpesaToCheck._sum.amount || 0) },
    },
    staff: [...staff.values()].sort((a, b) => risk(b) - risk(a)),
    voids: voids.slice(0, 200).map((v) => ({
      id: v.id,
      kind: v.kind,
      saleId: v.saleId,
      itemName: v.itemName,
      quantity: v.quantity,
      value: v.value,
      reason: v.reason,
      stockDeducted: v.stockDeducted,
      requestedBy: nameOf(v.requestedBy),
      approvedBy: nameOf(v.approvedBy),
      createdAt: v.createdAt,
    })),
    discounts: discounted.slice(0, 200).map((d) => ({
      saleId: d.id,
      orderNumber: d.orderNumber,
      amount: d.discountAmount,
      percent: d.subtotal > 0 ? round2((d.discountAmount / d.subtotal) * 100) : null,
      reason: d.discountReason,
      appliedBy: nameOf(d.discountAppliedBy),
      approvedBy: nameOf(d.discountApprovedBy),
      createdAt: d.createdAt,
    })),
    refunds: refunds.slice(0, 200).map((r) => ({
      paymentId: r.id,
      orderNumber: r.sale?.orderNumber,
      amount: r.amount,
      method: r.method,
      reason: r.refundReason,
      refundedBy: nameOf(r.refundedBy),
      approvedBy: nameOf(r.refundApprovedBy),
      refundedAt: r.refundedAt,
    })),
    unpaid: unpaid.slice(0, 200).map((u) => ({
      saleId: u.id,
      orderNumber: u.orderNumber,
      status: u.status,
      table: u.table ? u.table.name || `Table ${u.table.tableNumber}` : null,
      balance: round2(u.totalAmount - u.amountPaid),
      createdBy: nameOf(u.createdBy),
      servedBy: nameOf(u.servedBy),
      createdAt: u.createdAt,
    })),
  };
}
