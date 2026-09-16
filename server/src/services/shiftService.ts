import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response } from 'express';
import { createAuditLog } from './auditLogService';

const scope = (req: AuthRequest) => req.user!.branchId
  ? { restaurantId: req.user!.restaurantId, branchId: req.user!.branchId }
  : { restaurantId: req.user!.restaurantId };

const cashSummary = async (shift: any, endAt = new Date()) => {
  const payments = await prisma.payment.findMany({
    where: {
      restaurantId: shift.restaurantId,
      branchId: shift.branchId,
      createdBy: shift.userId,
      method: 'CASH',
      status: 'COMPLETED',
      createdAt: { gte: shift.openedAt, lte: endAt },
    },
    select: { amount: true },
  });
  const expenses = await prisma.expense.findMany({
    where: { shiftId: shift.id, status: 'APPROVED', paymentMethod: 'CASH' },
    select: { amount: true },
  });
  const cashPayments = payments.reduce((sum, p) => sum + p.amount, 0);
  const cashExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  return { cashPayments, cashExpenses, expectedCash: shift.openingCash + cashPayments - cashExpenses };
};

export const getShifts = async (req: AuthRequest, res: Response) => {
  const { status, userId, from, to } = req.query as any;
  const where: any = scope(req);
  if (status) where.status = status;
  if (userId) where.userId = userId;
  if (from || to) where.openedAt = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };

  const shifts = await prisma.shift.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      branch: { select: { id: true, name: true } },
      creator: { select: { firstName: true, lastName: true } },
      closer: { select: { firstName: true, lastName: true } },
    },
    orderBy: { openedAt: 'desc' },
  });

  const data = await Promise.all(shifts.map(async (shift) => {
    const summary = await cashSummary(shift, shift.closedAt || new Date());
    return {
      ...shift,
      userName: `${shift.user.firstName} ${shift.user.lastName}`,
      branchName: shift.branch.name,
      ...summary,
      expectedCash: shift.expectedCash ?? summary.expectedCash,
      cashVariance: shift.cashVariance ?? (shift.closingCash != null ? shift.closingCash - summary.expectedCash : null),
    };
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
  return sendResponse(res, true, 'Current shift retrieved', { shift: { ...shift, ...summary } });
};

export const openShift = async (req: AuthRequest, res: Response) => {
  const branchId = req.user!.branchId;
  const openingCash = Number(req.body.openingCash ?? 0);
  if (!branchId) return sendError(res, 'Select an active branch before opening a shift');
  if (!Number.isFinite(openingCash) || openingCash < 0) return sendError(res, 'Opening cash must be zero or greater');
  const existing = await prisma.shift.findFirst({
    where: { restaurantId: req.user!.restaurantId, branchId, userId: req.user!.id, status: 'OPEN' },
  });
  if (existing) return sendError(res, 'You already have an open shift', undefined, 409);

  const shift = await prisma.shift.create({
    data: {
      restaurantId: req.user!.restaurantId,
      branchId,
      userId: req.user!.id,
      createdBy: req.user!.id,
      openingCash,
      notes: req.body.notes || undefined,
    },
  });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'OPEN', 'Shift', shift.id, `Opened shift with KES ${openingCash.toLocaleString()}`);
  return sendResponse(res, true, 'Shift opened', { shift }, 201);
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

  const closingCash = Number(req.body.closingCash);
  if (!Number.isFinite(closingCash) || closingCash < 0) return sendError(res, 'Closing cash must be zero or greater');
  const closedAt = new Date();
  const summary = await cashSummary(shift, closedAt);
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: 'CLOSED',
      closedAt,
      closingCash,
      expectedCash: summary.expectedCash,
      cashVariance: closingCash - summary.expectedCash,
      closedBy: req.user!.id,
      notes: req.body.notes ?? shift.notes,
    },
  });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'CLOSE', 'Shift', shift.id, `Closed shift with variance KES ${(closingCash - summary.expectedCash).toLocaleString()}`);
  return sendResponse(res, true, 'Shift closed', { shift: updated });
};
