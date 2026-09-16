import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { Response as ExpressResponse } from 'express';
import { sendResponse, sendError } from '../utils/response';
import { createAuditLog } from './auditLogService';

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED'];
const VALID_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

async function ensureTableAvailable(restaurantId: string, branchId: string, tableId: string | null, startAt: Date, endAt: Date, excludeId?: string) {
  if (!tableId) return null;
  const table = await prisma.table.findFirst({ where: { id: tableId, branchId, restaurantId } });
  if (!table) throw new Error('INVALID_TABLE');
  if (endAt <= startAt) throw new Error('INVALID_TIME_RANGE');
  const conflict = await prisma.reservation.findFirst({
    where: {
      restaurantId,
      branchId,
      tableId,
      status: { in: ACTIVE_STATUSES },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, customerName: true, startAt: true, endAt: true },
  });
  if (conflict) throw new Error('TABLE_CONFLICT');
  return table;
}

function parseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_DATE');
  return date;
}

export const getReservations = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { branchId, status, date, search } = req.query;
  const where: any = { restaurantId };
  if (req.user!.branchId) where.branchId = req.user!.branchId;
  else if (branchId) where.branchId = branchId as string;
  if (status) where.status = status as string;
  if (search) where.OR = [
    { customerName: { contains: search as string } },
    { phone: { contains: search as string } },
  ];
  if (date) {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59.999`);
    where.startAt = { gte: start, lte: end };
  }

  const reservations = await prisma.reservation.findMany({
    where,
    orderBy: { startAt: 'asc' },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      table: { select: { id: true, tableNumber: true, name: true, capacity: true } },
      customer: { select: { id: true, name: true, phone: true } },
      creator: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return sendResponse(res, true, 'Reservations retrieved', { reservations });
};

export const getReservation = async (req: AuthRequest, res: ExpressResponse) => {
  const reservation = await prisma.reservation.findFirst({
    where: { id: req.params.id, restaurantId: req.user!.restaurantId },
    include: {
      branch: true,
      table: true,
      customer: true,
      creator: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!reservation) return sendError(res, 'Reservation not found', undefined, 404);
  return sendResponse(res, true, 'Reservation retrieved', reservation);
};

export const createReservation = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const createdBy = req.user!.id;
  const branchId = req.user!.branchId || req.body.branchId;
  const { customerId, tableId, customerName, phone, email, partySize, startAt: rawStartAt, endAt: rawEndAt, durationMinutes, notes, source, status } = req.body;
  if (!branchId || !customerName || !partySize || !rawStartAt) return sendError(res, 'Branch, customer name, party size and start time are required');
  const startAt = parseDate(rawStartAt);
  const endAt = rawEndAt ? parseDate(rawEndAt) : new Date(startAt.getTime() + Number(durationMinutes || 90) * 60000);
  if (endAt <= startAt) return sendError(res, 'End time must be after start time');
  if (Number(partySize) < 1) return sendError(res, 'Party size must be at least 1');
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) return sendError(res, 'Invalid branch', undefined, 400);
  try { await ensureTableAvailable(restaurantId, branchId, tableId || null, startAt, endAt); } catch (e: any) {
    const messages: any = { INVALID_TABLE: 'Selected table is invalid for this branch', TABLE_CONFLICT: 'Selected table is already reserved for this time', INVALID_TIME_RANGE: 'Invalid reservation time range' };
    return sendError(res, messages[e.message] || 'Unable to create reservation');
  }
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, restaurantId } });
    if (!customer) return sendError(res, 'Invalid customer');
  }
  const reservation = await prisma.reservation.create({
    data: { restaurantId, branchId, customerId: customerId || null, tableId: tableId || null, customerName, phone: phone || null, email: email || null, partySize: Number(partySize), startAt, endAt, status: status && VALID_STATUSES.includes(status) ? status : 'PENDING', notes: notes || null, source: source || 'PHONE', createdBy },
    include: { branch: { select: { id: true, name: true } }, table: { select: { id: true, tableNumber: true, name: true } } },
  });
  await createAuditLog(restaurantId, createdBy, 'CREATE', 'Reservation', reservation.id, `Created reservation for ${customerName}`);
  return sendResponse(res, true, 'Reservation created successfully', reservation, 201);
};

export const updateReservation = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const existing = await prisma.reservation.findFirst({ where: { id: req.params.id, restaurantId } });
  if (!existing) return sendError(res, 'Reservation not found', undefined, 404);
  const { customerId, tableId, customerName, phone, email, partySize, startAt: rawStartAt, endAt: rawEndAt, durationMinutes, notes, source, status } = req.body;
  const startAt = rawStartAt ? parseDate(rawStartAt) : existing.startAt;
  const endAt = rawEndAt ? parseDate(rawEndAt) : (durationMinutes ? new Date(startAt.getTime() + Number(durationMinutes) * 60000) : existing.endAt);
  try { await ensureTableAvailable(restaurantId, existing.branchId, tableId !== undefined ? (tableId || null) : existing.tableId, startAt, endAt, existing.id); } catch (e: any) {
    const messages: any = { INVALID_TABLE: 'Selected table is invalid for this branch', TABLE_CONFLICT: 'Selected table is already reserved for this time', INVALID_TIME_RANGE: 'Invalid reservation time range' };
    return sendError(res, messages[e.message] || 'Unable to update reservation');
  }
  const updated = await prisma.reservation.update({
    where: { id: existing.id },
    data: {
      customerId: customerId !== undefined ? (customerId || null) : existing.customerId,
      tableId: tableId !== undefined ? (tableId || null) : existing.tableId,
      customerName: customerName || existing.customerName,
      phone: phone !== undefined ? (phone || null) : existing.phone,
      email: email !== undefined ? (email || null) : existing.email,
      partySize: partySize ? Number(partySize) : existing.partySize,
      startAt, endAt,
      status: status && VALID_STATUSES.includes(status) ? status : existing.status,
      notes: notes !== undefined ? (notes || null) : existing.notes,
      source: source || existing.source,
    },
  });
  await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Reservation', updated.id, `Updated reservation for ${updated.customerName}`);
  return sendResponse(res, true, 'Reservation updated successfully', updated);
};

export const updateReservationStatus = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return sendError(res, `Invalid reservation status. Must be one of: ${VALID_STATUSES.join(', ')}`);
  const existing = await prisma.reservation.findFirst({ where: { id: req.params.id, restaurantId } });
  if (!existing) return sendError(res, 'Reservation not found', undefined, 404);
  if (status === 'SEATED' && existing.tableId) {
    await prisma.table.update({ where: { id: existing.tableId }, data: { status: 'OCCUPIED' } });
  }
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status) && existing.tableId) {
    const activeSale = await prisma.sale.findFirst({ where: { tableId: existing.tableId, status: { in: ['DRAFT', 'SUBMITTED', 'HELD'] } }, select: { id: true } });
    if (!activeSale) await prisma.table.update({ where: { id: existing.tableId }, data: { status: 'AVAILABLE' } });
  }
  const updated = await prisma.reservation.update({ where: { id: existing.id }, data: { status } });
  await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Reservation', updated.id, `Reservation ${updated.id} changed to ${status}`);
  return sendResponse(res, true, 'Reservation status updated successfully', updated);
};

export const deleteReservation = async (req: AuthRequest, res: ExpressResponse) => {
  const existing = await prisma.reservation.findFirst({ where: { id: req.params.id, restaurantId: req.user!.restaurantId } });
  if (!existing) return sendError(res, 'Reservation not found', undefined, 404);
  await prisma.reservation.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'DELETE', 'Reservation', existing.id, `Cancelled reservation for ${existing.customerName}`);
  return sendResponse(res, true, 'Reservation cancelled successfully');
};
