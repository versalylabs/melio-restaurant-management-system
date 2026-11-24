import { lockTables, syncTableStatus } from './tableFloorService';
import { realtimeService } from './realtimeService';
import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { Response as ExpressResponse } from 'express';
import { sendResponse, sendError } from '../utils/response';
import { createAuditLog } from './auditLogService';
import { getRestaurantTimeZone, localDayRange, startOfLocalDay } from '../utils/timezone';
import { boundedLimit } from '../utils/pagination';

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED'];
const VALID_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

/**
 * Checks a table is free for [startAt, endAt). Must run inside the transaction
 * that writes the reservation: it locks the table row first, so two bookings
 * for the same table and time are serialised and the second sees the first.
 */
export async function ensureTableAvailable(tx: Prisma.TransactionClient, restaurantId: string, branchId: string, tableId: string | null, startAt: Date, endAt: Date, excludeId?: string) {
  if (endAt <= startAt) throw new Error('INVALID_TIME_RANGE');
  if (!tableId) return null;
  await tx.$queryRaw`SELECT id FROM "tables" WHERE id = ${tableId} FOR UPDATE`;
  const table = await tx.table.findFirst({ where: { id: tableId, branchId, restaurantId } });
  if (!table) throw new Error('INVALID_TABLE');
  const conflict = await tx.reservation.findFirst({
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
  const { branchId, status, date, search, upcoming } = req.query;
  const where: any = { restaurantId };
  if (req.user!.branchId) where.branchId = req.user!.branchId;
  else if (branchId && branchId !== 'ALL') where.branchId = branchId as string;
  if (status && status !== 'ALL') where.status = status as string;
  if (search) where.OR = [
    { customerName: { contains: search as string } },
    { phone: { contains: search as string } },
  ];
  // Dates are the restaurant's local calendar days (the server runs in UTC).
  const timeZone = await getRestaurantTimeZone(restaurantId);
  if (upcoming === 'true') {
    where.startAt = { gte: startOfLocalDay(timeZone) };
  } else if (date && date !== 'ALL') {
    const range = localDayRange(String(date), timeZone);
    if (!range) return sendError(res, 'Invalid date');
    where.startAt = { gte: range.start, lte: range.end };
  }

  // Upcoming / single-day views read forward from the start. The open-ended
  // "all dates" view keeps the most recent bookings when capped, then shows
  // them in date order.
  const newestFirst = upcoming !== 'true' && (!date || date === 'ALL');
  const reservations = await prisma.reservation.findMany({
    where,
    orderBy: { startAt: newestFirst ? 'desc' : 'asc' },
    take: boundedLimit(req.query.limit, 500, 1000),
    include: {
      branch: { select: { id: true, name: true, code: true, address: true, city: true, phone: true } },
      table: { select: { id: true, tableNumber: true, name: true, capacity: true } },
      customer: { select: { id: true, name: true, phone: true } },
      creator: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (newestFirst) reservations.reverse();
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
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, restaurantId } });
    if (!customer) return sendError(res, 'Invalid customer');
  }
  const finalStatus = status && VALID_STATUSES.includes(status) ? status : 'PENDING';
  let reservation;
  try {
    reservation = await prisma.$transaction(async (tx) => {
      if (ACTIVE_STATUSES.includes(finalStatus)) await ensureTableAvailable(tx, restaurantId, branchId, tableId || null, startAt, endAt);
      else if (endAt <= startAt) throw new Error('INVALID_TIME_RANGE');
      return tx.reservation.create({
        data: { restaurantId, branchId, customerId: customerId || null, tableId: tableId || null, customerName, phone: phone || null, email: email || null, partySize: Number(partySize), startAt, endAt, status: finalStatus, notes: notes || null, source: source || 'PHONE', createdBy },
        include: { branch: { select: { id: true, name: true } }, table: { select: { id: true, tableNumber: true, name: true } } },
      });
    });
  } catch (e: any) {
    const messages: any = { INVALID_TABLE: 'Selected table is invalid for this branch', TABLE_CONFLICT: 'Selected table is already reserved for this time', INVALID_TIME_RANGE: 'Invalid reservation time range' };
    if (messages[e.message]) return sendError(res, messages[e.message], undefined, e.message === 'TABLE_CONFLICT' ? 409 : 400);
    throw e;
  }
  await createAuditLog(restaurantId, createdBy, 'CREATE', 'Reservation', reservation.id, `Created reservation for ${customerName}`);
  realtimeService.broadcast(`reservations:${reservation.branchId}`, 'reservation_status_updated', { reservationId: reservation.id });
  return sendResponse(res, true, 'Reservation created successfully', reservation, 201);
};

export const updateReservation = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const existing = await prisma.reservation.findFirst({ where: { id: req.params.id, restaurantId } });
  if (!existing) return sendError(res, 'Reservation not found', undefined, 404);
  const { customerId, tableId, customerName, phone, email, partySize, startAt: rawStartAt, endAt: rawEndAt, durationMinutes, notes, source, status } = req.body;
  const startAt = rawStartAt ? parseDate(rawStartAt) : existing.startAt;
  const endAt = rawEndAt ? parseDate(rawEndAt) : (durationMinutes ? new Date(startAt.getTime() + Number(durationMinutes) * 60000) : existing.endAt);
  const nextStatus = status && VALID_STATUSES.includes(status) ? status : existing.status;
  const nextTableId = tableId !== undefined ? (tableId || null) : existing.tableId;
  let updated;
  try {
  updated = await prisma.$transaction(async (tx) => {
  if (ACTIVE_STATUSES.includes(nextStatus)) await ensureTableAvailable(tx, restaurantId, existing.branchId, nextTableId, startAt, endAt, existing.id);
  else if (endAt <= startAt) throw new Error('INVALID_TIME_RANGE');
  return tx.reservation.update({
    where: { id: existing.id },
    data: {
      customerId: customerId !== undefined ? (customerId || null) : existing.customerId,
      tableId: tableId !== undefined ? (tableId || null) : existing.tableId,
      customerName: customerName || existing.customerName,
      phone: phone !== undefined ? (phone || null) : existing.phone,
      email: email !== undefined ? (email || null) : existing.email,
      partySize: partySize ? Number(partySize) : existing.partySize,
      startAt, endAt,
      status: nextStatus,
      notes: notes !== undefined ? (notes || null) : existing.notes,
      source: source || existing.source,
    },
  });
  });
  } catch (e: any) {
    const messages: any = { INVALID_TABLE: 'Selected table is invalid for this branch', TABLE_CONFLICT: 'Selected table is already reserved for this time', INVALID_TIME_RANGE: 'Invalid reservation time range' };
    if (messages[e.message]) return sendError(res, messages[e.message], undefined, e.message === 'TABLE_CONFLICT' ? 409 : 400);
    throw e;
  }
  await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Reservation', updated.id, `Updated reservation for ${updated.customerName}`);
  realtimeService.broadcast(`reservations:${updated.branchId}`, 'reservation_status_updated', { reservationId: updated.id });
  return sendResponse(res, true, 'Reservation updated successfully', updated);
};

export const updateReservationStatus = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return sendError(res, `Invalid reservation status. Must be one of: ${VALID_STATUSES.join(', ')}`);
  const existing = await prisma.reservation.findFirst({ where: { id: req.params.id, restaurantId } });
  if (!existing) return sendError(res, 'Reservation not found', undefined, 404);
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Re-activating a cancelled / no-show booking must not double-book its table.
      if (ACTIVE_STATUSES.includes(status) && !ACTIVE_STATUSES.includes(existing.status)) {
        await ensureTableAvailable(tx, restaurantId, existing.branchId, existing.tableId, existing.startAt, existing.endAt, existing.id);
      }
      if (status === 'SEATED' && existing.tableId) {
        await lockTables(tx, [existing.tableId]);
        await tx.table.updateMany({ where: { id: existing.tableId, status: { in: ['AVAILABLE', 'RESERVED', 'CLEANING'] } }, data: { status: 'OCCUPIED' } });
      }
      if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status) && existing.tableId) {
        await lockTables(tx, [existing.tableId]);
        if (existing.status === 'SEATED') {
          // The party that sat there left: clear the table (unless others are eating there).
          await syncTableStatus(tx, existing.tableId, status === 'COMPLETED' ? 'CLEANING' : 'AVAILABLE');
        } else {
          // A booking that never sat down only releases its hold on the table.
          await tx.table.updateMany({ where: { id: existing.tableId, status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
        }
      }
      return tx.reservation.update({ where: { id: existing.id }, data: { status } });
    });
  } catch (e: any) {
    if (e.message === 'TABLE_CONFLICT') return sendError(res, 'That table has been booked for this time in the meantime. Choose another table first.', undefined, 409);
    throw e;
  }
  await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Reservation', updated.id, `Reservation ${updated.id} changed to ${status}`);
  realtimeService.broadcast(`reservations:${updated.branchId}`, 'reservation_status_updated', { reservationId: updated.id });
  return sendResponse(res, true, 'Reservation status updated successfully', updated);
};

export const deleteReservation = async (req: AuthRequest, res: ExpressResponse) => {
  const existing = await prisma.reservation.findFirst({ where: { id: req.params.id, restaurantId: req.user!.restaurantId } });
  if (!existing) return sendError(res, 'Reservation not found', undefined, 404);
  await prisma.reservation.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'DELETE', 'Reservation', existing.id, `Cancelled reservation for ${existing.customerName}`);
  return sendResponse(res, true, 'Reservation cancelled successfully');
};
