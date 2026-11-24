import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response } from 'express';
import { createAuditLog } from './auditLogService';
import { boundedLimit } from '../utils/pagination';
import { getRestaurantTimeZone } from '../utils/timezone';
import { rangeDates, toCsv } from './reportService';

const scope = (req: AuthRequest) => req.user!.branchId
  ? { restaurantId: req.user!.restaurantId, branchId: req.user!.branchId }
  : { restaurantId: req.user!.restaurantId };

const MANAGER_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the till should hold, by payment method, for the payments this cashier took during the shift. */
const cashSummary = async (shift: any, endAt = new Date()) => {
  const payments = await prisma.payment.groupBy({
    by: ['method'],
    where: {
      restaurantId: shift.restaurantId,
      branchId: shift.branchId,
      createdBy: shift.userId,
      // DUPLICATE: paid twice and awaiting a refund; the money is in the till until then.
      status: { in: ['COMPLETED', 'DUPLICATE'] },
      createdAt: { gte: shift.openedAt, lte: endAt },
    },
    _sum: { amount: true },
  });
  const byMethod = (m: string) => round2(payments.find((p) => p.method === m)?._sum.amount || 0);
  const expenses = await prisma.expense.findMany({
    // Pending too: the cash has already left the till; a rejected expense is not counted.
    where: { shiftId: shift.id, status: { in: ['APPROVED', 'PENDING'] }, paymentMethod: 'CASH' },
    select: { amount: true },
  });
  const cashPayments = byMethod('CASH');
  const cashExpenses = round2(expenses.reduce((sum, e) => sum + e.amount, 0));
  return {
    cashPayments,
    cashExpenses,
    expectedCash: round2(shift.openingCash + cashPayments - cashExpenses),
    expectedMobileMoney: byMethod('MOBILE_MONEY'),
    expectedCard: byMethod('CARD'),
  };
};

/**
 * Blind close: while a shift is open, the cashier doesn't see what the till
 * "should" hold, so they count what is really there instead of matching a
 * number. Managers still see everything.
 */
const EXPECTED_FIELDS = ['cashPayments', 'cashExpenses', 'expectedCash', 'expectedMobileMoney', 'expectedCard', 'cashVariance', 'mobileMoneyVariance', 'cardVariance'];
const hideExpected = (shift: any) => {
  const copy = { ...shift, blind: true };
  for (const f of EXPECTED_FIELDS) delete copy[f];
  return copy;
};
const canSeeExpected = (req: AuthRequest, shift: { status: string }) => shift.status !== 'OPEN' || MANAGER_ROLES.includes(req.user!.roleName);

export const getShifts = async (req: AuthRequest, res: Response) => {
  const { status, userId, from, to } = req.query as any;
  const where: any = scope(req);
  if (status) where.status = status;
  if (userId) where.userId = userId;
  if (from || to) where.openedAt = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
  // Unfiltered view: open shifts plus anything opened in the last 30 days.
  else if (!status) where.OR = [{ status: 'OPEN' }, { openedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }];

  const shifts = await prisma.shift.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      branch: { select: { id: true, name: true } },
      creator: { select: { firstName: true, lastName: true } },
      closer: { select: { firstName: true, lastName: true } },
    },
    orderBy: { openedAt: 'desc' },
    take: boundedLimit(req.query.limit, 200, 500),
  });

  const data = await Promise.all(shifts.map(async (shift) => {
    const summary = await cashSummary(shift, shift.closedAt || new Date());
    const row = {
      ...shift,
      userName: `${shift.user.firstName} ${shift.user.lastName}`,
      branchName: shift.branch.name,
      ...summary,
      expectedCash: shift.expectedCash ?? summary.expectedCash,
      cashVariance: shift.cashVariance ?? (shift.closingCash != null ? shift.closingCash - summary.expectedCash : null),
      expectedMobileMoney: shift.expectedMobileMoney ?? summary.expectedMobileMoney,
      expectedCard: shift.expectedCard ?? summary.expectedCard,
    };
    return canSeeExpected(req, shift) ? row : hideExpected(row);
  }));

  return sendResponse(res, true, 'Shifts retrieved', { shifts: data });
};

export const getCurrentShift = async (req: AuthRequest, res: Response) => {
  const branchId = req.user!.branchId;
  if (!branchId) return sendResponse(res, true, 'Current shift retrieved', { shift: null });
  const shift = await prisma.shift.findFirst({
    where: { restaurantId: req.user!.restaurantId, branchId, userId: req.user!.id, status: 'OPEN' },
    include: { branch: true },
  });
  if (!shift) return sendResponse(res, true, 'Current shift retrieved', { shift: null });
  const summary = await cashSummary(shift);
  const row = { ...shift, ...summary };
  return sendResponse(res, true, 'Current shift retrieved', { shift: canSeeExpected(req, shift) ? row : hideExpected(row) });
};

export const openShift = async (req: AuthRequest, res: Response) => {
  const branchId = req.user!.branchId;
  const openingCash = Number(req.body.openingCash ?? 0);
  if (!branchId) return sendError(res, 'Select an active branch before opening a shift');
  if (!Number.isFinite(openingCash) || openingCash < 0) return sendError(res, 'Opening cash must be zero or greater');

  try {
    const shift = await prisma.$transaction(async (tx) => {
      const existing = await tx.shift.findFirst({
        where: { restaurantId: req.user!.restaurantId, branchId, userId: req.user!.id, status: 'OPEN' },
      });
      if (existing) throw new Error('ALREADY_OPEN');

      return tx.shift.create({
        data: {
          restaurantId: req.user!.restaurantId,
          branchId,
          userId: req.user!.id,
          createdBy: req.user!.id,
          openingCash,
          notes: req.body.notes || undefined,
        },
      });
    });

    await createAuditLog(req.user!.restaurantId, req.user!.id, 'OPEN', 'Shift', shift.id, `Opened shift with KES ${openingCash.toLocaleString()}`);
    return sendResponse(res, true, 'Shift opened', { shift }, 201);
  } catch (err: any) {
    if (err?.message === 'ALREADY_OPEN') {
      return sendError(res, 'You already have an open shift', undefined, 409);
    }
    console.error('Open shift failed:', err);
    return sendError(res, 'Failed to open shift', undefined, 500);
  }
};

export const closeShift = async (req: AuthRequest, res: Response) => {
  const shift = await prisma.shift.findFirst({
    where: { id: req.params.id, restaurantId: req.user!.restaurantId },
  });
  if (!shift) return sendError(res, 'Shift not found', undefined, 404);
  if (shift.status !== 'OPEN') return sendError(res, 'Shift is already closed');
  if (shift.userId !== req.user!.id && !['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.roleName)) {
    return sendError(res, 'You can only close your own shift', undefined, 403);
  }

  const amount = (value: unknown) => (value === undefined || value === null || value === '' ? NaN : Number(value));
  const closingCash = amount(req.body.closingCash);
  // All three are required: a missing figure would record the whole expected amount as short.
  const declaredMobileMoney = amount(req.body.declaredMobileMoney);
  const declaredCard = amount(req.body.declaredCard);
  if (!Number.isFinite(closingCash) || closingCash < 0) return sendError(res, 'Enter the cash you counted (zero or more)');
  if (!Number.isFinite(declaredMobileMoney) || declaredMobileMoney < 0) return sendError(res, 'Enter the M-Pesa total (zero or more)');
  if (!Number.isFinite(declaredCard) || declaredCard < 0) return sendError(res, 'Enter the card total (zero or more)');
  const closedAt = new Date();
  const summary = await cashSummary(shift, closedAt);
  const cashVariance = round2(closingCash - summary.expectedCash);
  const mobileMoneyVariance = round2(declaredMobileMoney - summary.expectedMobileMoney);
  const cardVariance = round2(declaredCard - summary.expectedCard);
  // Conditional update: two closes of the same shift can't both succeed.
  const closed = await prisma.shift.updateMany({
    where: { id: shift.id, status: 'OPEN' },
    data: {
      status: 'CLOSED',
      closedAt,
      closingCash,
      expectedCash: summary.expectedCash,
      cashVariance,
      declaredMobileMoney,
      expectedMobileMoney: summary.expectedMobileMoney,
      mobileMoneyVariance,
      declaredCard,
      expectedCard: summary.expectedCard,
      cardVariance,
      closedBy: req.user!.id,
      notes: req.body.notes ?? shift.notes,
    },
  });
  if (closed.count === 0) return sendError(res, 'Shift is already closed');
  const updated = await prisma.shift.findUnique({ where: { id: shift.id } });
  const fmt = (n: number) => `KES ${n.toLocaleString()}`;
  await createAuditLog(
    req.user!.restaurantId,
    req.user!.id,
    'CLOSE',
    'Shift',
    shift.id,
    `Closed shift. Differences: cash ${fmt(cashVariance)}, M-Pesa ${fmt(mobileMoneyVariance)}, card ${fmt(cardVariance)}`
  );
  // Now that the count is in, the cashier sees how it compared.
  return sendResponse(res, true, 'Shift closed', { shift: { ...updated, ...summary } });
};

/**
 * GET /shifts/hours?startDate&endDate[&format=csv]: hours each person worked
 * on the till, for whoever runs payroll. Counts closed shifts that started in
 * the range; open shifts are listed apart because their hours aren't final.
 */
export const shiftHours = async (req: AuthRequest, res: Response) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId || (typeof req.query.branchId === 'string' && req.query.branchId ? req.query.branchId : undefined);
  const timeZone = await getRestaurantTimeZone(restaurantId);
  const { start, end } = rangeDates(typeof req.query.startDate === 'string' ? req.query.startDate : undefined, typeof req.query.endDate === 'string' ? req.query.endDate : undefined, timeZone);
  const shifts = await prisma.shift.findMany({
    where: { restaurantId, ...(branchId ? { branchId } : {}), openedAt: { gte: start, lte: end } },
    select: { userId: true, status: true, openedAt: true, closedAt: true },
  });
  const users = await prisma.user.findMany({
    where: { restaurantId, id: { in: [...new Set(shifts.map((s) => s.userId))] } },
    select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } },
  });
  const rows = new Map<string, { name: string; role: string; shifts: number; days: Set<string>; hours: number; openShifts: number }>();
  for (const s of shifts) {
    const u = users.find((x) => x.id === s.userId);
    const r = rows.get(s.userId) || { name: u ? `${u.firstName} ${u.lastName}`.trim() : 'Former staff member', role: u?.role?.name || '', shifts: 0, days: new Set<string>(), hours: 0, openShifts: 0 };
    if (s.status === 'OPEN' || !s.closedAt) r.openShifts += 1;
    else {
      r.shifts += 1;
      r.hours += (s.closedAt.getTime() - s.openedAt.getTime()) / 3_600_000;
      r.days.add(s.openedAt.toLocaleDateString('en-CA', { timeZone }));
    }
    rows.set(s.userId, r);
  }
  const staff = [...rows.entries()]
    .map(([userId, r]) => ({ userId, name: r.name, role: r.role, shifts: r.shifts, days: r.days.size, hours: Math.round(r.hours * 100) / 100, openShifts: r.openShifts }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (req.query.format === 'csv') {
    const csv = toCsv(staff, [
      { key: 'name', label: 'Staff member' }, { key: 'role', label: 'Role' }, { key: 'days', label: 'Days worked' },
      { key: 'shifts', label: 'Shifts closed' }, { key: 'hours', label: 'Hours' }, { key: 'openShifts', label: 'Shifts still open (not counted)' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shift-hours-${start.toLocaleDateString('en-CA', { timeZone })}-to-${end.toLocaleDateString('en-CA', { timeZone })}.csv"`);
    return res.send(`﻿${csv}`);
  }
  return sendResponse(res, true, 'Shift hours', {
    range: { start, end, timeZone },
    staff,
    totals: { hours: Math.round(staff.reduce((t, s) => t + s.hours, 0) * 100) / 100, shifts: staff.reduce((t, s) => t + s.shifts, 0) },
  });
};
