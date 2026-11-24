import { Prisma } from '@prisma/client';
import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendError, sendResponse } from '../utils/response';
import { getRestaurantTimeZone, localDayRange } from '../utils/timezone';
import { createAuditLog } from './auditLogService';
import { lockSale } from './saleLedgerService';
import { realtimeService } from './realtimeService';

type Tx = Prisma.TransactionClient;

/** Orders that mean guests are at the table (sent to the kitchen, not yet closed). */
export const SEATED_ORDER_STATUSES = ['SUBMITTED', 'PREPARING', 'READY', 'SERVED'];
/** Orders still open on a table, including ones held at the till. */
export const OPEN_ORDER_STATUSES = ['DRAFT', 'HELD', ...SEATED_ORDER_STATUSES];
const MANAGERS = ['OWNER', 'ADMIN', 'MANAGER'];
const RESERVATION_ACTIVE = ['PENDING', 'CONFIRMED'];
const RESERVED_SOON_MS = 45 * 60 * 1000;
/** Guests seated longer than this are flagged (slow table, or the bill was forgotten). */
const LONG_SITTING_MIN = 90;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Locks table rows in id order, so two requests never wait on each other in a circle. */
export async function lockTables(tx: Tx, ids: Array<string | null | undefined>) {
  for (const id of [...new Set(ids.filter(Boolean) as string[])].sort()) {
    await tx.$queryRaw`SELECT id FROM "tables" WHERE id = ${id} FOR UPDATE`;
  }
}

/**
 * Brings a table's status in line with its orders. Open (kitchen) orders mean
 * OCCUPIED; when the last one goes, an OCCUPIED table becomes `whenEmptied`.
 * Out-of-service and removed tables are never touched. Call inside the
 * transaction that changed the orders, after the change; locks the table row.
 */
export async function syncTableStatus(tx: Tx, tableId: string | null | undefined, whenEmptied: 'AVAILABLE' | 'CLEANING' = 'AVAILABLE') {
  if (!tableId) return;
  const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "tables" WHERE id = ${tableId} FOR UPDATE`;
  const status = rows[0]?.status;
  if (!status || status === 'OUT_OF_SERVICE' || status === 'INACTIVE') return;
  const seated = await tx.sale.count({ where: { tableId, status: { in: SEATED_ORDER_STATUSES } } });
  if (seated > 0) {
    if (status !== 'OCCUPIED') await tx.table.update({ where: { id: tableId }, data: { status: 'OCCUPIED' } });
  } else if (status === 'OCCUPIED') {
    await tx.table.update({ where: { id: tableId }, data: { status: whenEmptied } });
  }
}

const broadcastFloor = (branchId: string, tableId: string) =>
  realtimeService.broadcast(`orders:${branchId}`, 'table_updated', { tableId });

/** The branch a request is about: staff are held to their own branch. */
function branchFor(req: AuthRequest) {
  return req.user!.branchId || (typeof req.query.branchId === 'string' && req.query.branchId) || (typeof req.body?.branchId === 'string' && req.body.branchId) || '';
}

/**
 * GET /tables/live — the service board: every table with what is happening at
 * it now (orders, bill, time seated, kitchen, next booking), worked out from
 * the orders themselves rather than the stored status alone.
 */
export const getLiveFloor = async (req: AuthRequest, res: Response) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = branchFor(req);
  if (!branchId) return sendError(res, 'Choose a branch first');
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId }, select: { id: true } });
  if (!branch) return sendError(res, 'Branch not found', undefined, 404);

  const now = new Date();
  const [tables, sections] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId, branchId, status: { not: 'INACTIVE' } },
      select: { id: true, tableNumber: true, name: true, capacity: true, shape: true, status: true, sectionId: true, positionX: true, positionY: true, width: true, height: true, rotation: true, updatedAt: true },
    }),
    prisma.section.findMany({ where: { restaurantId, branchId, status: 'ACTIVE' }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
  ]);
  const tableIds = tables.map((t) => t.id);
  const [orders, reservations] = await Promise.all([
    prisma.sale.findMany({
      where: { restaurantId, tableId: { in: tableIds }, status: { in: OPEN_ORDER_STATUSES } },
      select: {
        id: true, tableId: true, orderNumber: true, status: true, totalAmount: true, amountPaid: true, createdAt: true, servedBy: true, createdBy: true,
        payments: { where: { status: 'PENDING', reference: { not: null }, createdAt: { gt: new Date(now.getTime() - 5 * 60 * 1000) } }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.reservation.findMany({
      where: { restaurantId, tableId: { in: tableIds }, status: { in: RESERVATION_ACTIVE }, startAt: { gte: new Date(now.getTime() - 15 * 60 * 1000), lte: new Date(now.getTime() + 3 * 60 * 60 * 1000) } },
      select: { id: true, tableId: true, customerName: true, partySize: true, startAt: true, status: true },
      orderBy: { startAt: 'asc' },
    }),
  ]);
  const staffIds = [...new Set(orders.map((o) => o.servedBy || o.createdBy).filter(Boolean) as string[])];
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds }, restaurantId }, select: { id: true, firstName: true } }) : [];
  const firstName = new Map(staff.map((u) => [u.id, u.firstName]));

  const live = tables.map((t) => {
    const mine = orders.filter((o) => o.tableId === t.id);
    const seatedOrders = mine.filter((o) => SEATED_ORDER_STATUSES.includes(o.status));
    const total = round2(seatedOrders.reduce((s, o) => s + o.totalAmount, 0));
    const paid = round2(seatedOrders.reduce((s, o) => s + Math.min(o.amountPaid || 0, o.totalAmount), 0));
    const balance = round2(Math.max(0, total - paid));
    const next = reservations.find((r) => r.tableId === t.id) || null;
    const reservedSoon = !!next && next.startAt.getTime() - now.getTime() <= RESERVED_SOON_MS;
    const mpesaPending = seatedOrders.some((o) => o.payments.length > 0);

    let state: string;
    let since: Date | null = null;
    if (t.status === 'OUT_OF_SERVICE') state = 'OUT_OF_SERVICE';
    else if (seatedOrders.length) {
      since = seatedOrders[0].createdAt;
      if (seatedOrders.some((o) => o.status === 'READY')) state = 'FOOD_READY';
      else if (balance <= 0) state = 'PAID';
      else if (seatedOrders.every((o) => o.status === 'SERVED')) state = 'EATING';
      else state = 'ORDERED';
    } else if (t.status === 'OCCUPIED') { state = 'SEATED'; since = t.updatedAt; }
    else if (t.status === 'CLEANING') { state = 'CLEANING'; since = t.updatedAt; }
    else if (mine.length) state = 'HELD';
    else if (t.status === 'RESERVED' || reservedSoon) state = 'RESERVED';
    else state = 'FREE';
    const minutes = since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60000)) : null;
    const seatedState = ['ORDERED', 'FOOD_READY', 'EATING', 'PAID', 'SEATED'].includes(state);

    // One alert at most, the most urgent first.
    let alert: { kind: string; text: string } | null = null;
    if (state === 'FOOD_READY') alert = { kind: 'FOOD_READY', text: 'Food ready to serve' };
    else if (mpesaPending) alert = { kind: 'PAYING', text: 'M-Pesa payment in progress' };
    else if (reservedSoon && next && (seatedState || state === 'CLEANING')) alert = { kind: 'BOOKING', text: 'Booking soon' };
    else if (seatedState && minutes !== null && minutes >= LONG_SITTING_MIN && balance > 0 && state === 'EATING') alert = { kind: 'LONG', text: 'Served long ago, bill still open' };
    else if (state === 'SEATED' && minutes !== null && minutes >= 10) alert = { kind: 'NO_ORDER', text: 'Seated, no order yet' };

    const waiterId = seatedOrders[0]?.servedBy || seatedOrders[0]?.createdBy || mine[0]?.servedBy || null;
    return {
      id: t.id,
      tableNumber: t.tableNumber,
      name: t.name,
      capacity: t.capacity,
      shape: t.shape,
      status: t.status,
      sectionId: t.sectionId,
      positionX: t.positionX, positionY: t.positionY, width: t.width, height: t.height, rotation: t.rotation,
      state,
      minutes,
      total,
      paid,
      balance,
      waiterId,
      waiterName: waiterId ? firstName.get(waiterId) || null : null,
      alert,
      nextReservation: next ? { id: next.id, customerName: next.customerName, partySize: next.partySize, startAt: next.startAt, status: next.status } : null,
      orders: mine.map((o) => ({
        id: o.id, orderNumber: o.orderNumber, status: o.status, totalAmount: o.totalAmount,
        amountPaid: round2(Math.min(o.amountPaid || 0, o.totalAmount)), createdAt: o.createdAt,
        waiterName: firstName.get(o.servedBy || o.createdBy || '') || null,
        mine: (o.servedBy || o.createdBy) === req.user!.id,
      })),
    };
  });

  const count = (states: string[]) => live.filter((t) => states.includes(t.state)).length;
  const seatedStates = ['ORDERED', 'FOOD_READY', 'EATING', 'PAID', 'SEATED'];
  const summary: any = {
    free: count(['FREE']),
    occupied: count(seatedStates),
    cleaning: count(['CLEANING']),
    reserved: count(['RESERVED']),
    foodReady: count(['FOOD_READY']),
    outOfService: count(['OUT_OF_SERVICE']),
    tables: live.length,
    seats: live.filter((t) => t.state !== 'OUT_OF_SERVICE').reduce((s, t) => s + t.capacity, 0),
    seatsInUse: live.filter((t) => seatedStates.includes(t.state)).reduce((s, t) => s + t.capacity, 0),
  };

  // Today, for owners and managers: how the floor is turning.
  if (MANAGERS.includes(req.user!.roleName)) {
    summary.openBalance = round2(live.reduce((s, t) => s + t.balance, 0));
    const timeZone = await getRestaurantTimeZone(restaurantId);
    const day = localDayRange(now.toLocaleDateString('en-CA', { timeZone }), timeZone);
    if (day) {
      const closed = await prisma.sale.findMany({
        where: { restaurantId, branchId, tableId: { not: null }, status: 'COMPLETED', completedAt: { gte: day.start, lte: day.end } },
        select: { tableId: true, totalAmount: true, createdAt: true, completedAt: true },
      });
      const sectionOf = new Map(tables.map((t) => [t.id, t.sectionId]));
      const minutes = closed.map((s) => (s.completedAt!.getTime() - s.createdAt.getTime()) / 60000).filter((m) => m >= 0 && m < 12 * 60);
      const bySection = new Map<string, { sales: number; orders: number }>();
      for (const s of closed) {
        const key = sectionOf.get(s.tableId!) || 'NONE';
        const row = bySection.get(key) || { sales: 0, orders: 0 };
        row.sales += s.totalAmount;
        row.orders += 1;
        bySection.set(key, row);
      }
      summary.today = {
        tablesServed: closed.length,
        turnsPerTable: live.length ? round2(closed.length / live.length) : 0,
        averageMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
        sales: round2(closed.reduce((s, c) => s + c.totalAmount, 0)),
        bySection: [...bySection.entries()]
          .map(([id, v]) => ({ sectionId: id === 'NONE' ? null : id, name: id === 'NONE' ? 'No section' : sections.find((x) => x.id === id)?.name || 'Other', sales: round2(v.sales), orders: v.orders }))
          .sort((a, b) => b.sales - a.sales),
      };
    }
  }

  return sendResponse(res, true, 'Live floor', { generatedAt: now, branchId, sections, tables: live, summary, longSittingMinutes: LONG_SITTING_MIN });
};

/**
 * POST /tables/:id/service { action } — what any staff member does during service:
 * MARK_CLEAN (cleaning → free), SEAT (guests sat down before ordering),
 * CLEAR (guests left without an open order → needs cleaning).
 */
export const tableServiceAction = async (req: AuthRequest, res: Response) => {
  const action = String(req.body?.action || '');
  const rules: Record<string, { from: string[]; to: string; verb: string }> = {
    MARK_CLEAN: { from: ['CLEANING'], to: 'AVAILABLE', verb: 'marked clean' },
    SEAT: { from: ['AVAILABLE', 'RESERVED', 'CLEANING'], to: 'OCCUPIED', verb: 'seated guests at' },
    CLEAR: { from: ['OCCUPIED'], to: 'CLEANING', verb: 'cleared' },
  };
  const rule = rules[action];
  if (!rule) return sendError(res, 'Unknown table action');
  const restaurantId = req.user!.restaurantId;
  const table = await prisma.table.findFirst({
    where: { id: req.params.id, restaurantId, status: { not: 'INACTIVE' }, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
    select: { id: true, tableNumber: true, branchId: true },
  });
  if (!table) return sendError(res, 'Table not found', undefined, 404);

  const result = await prisma.$transaction(async (tx) => {
    await lockTables(tx, [table.id]);
    const current = await tx.table.findUnique({ where: { id: table.id }, select: { status: true } });
    const seated = await tx.sale.count({ where: { tableId: table.id, status: { in: SEATED_ORDER_STATUSES } } });
    if (action !== 'SEAT' && seated > 0) return { error: `Table ${table.tableNumber} still has an open order. Close or move it first.` };
    if (!current || !rule.from.includes(current.status)) {
      // Someone else already did it: not an error for the person tapping.
      if (current?.status === rule.to) return { status: current.status, unchanged: true };
      return { error: `Table ${table.tableNumber} is ${String(current?.status || '').toLowerCase().replace('_', ' ')} right now` };
    }
    await tx.table.update({ where: { id: table.id }, data: { status: rule.to } });
    return { status: rule.to, unchanged: false };
  });
  if ('error' in result) return sendError(res, result.error!, undefined, 409);
  if (!result.unchanged) {
    await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Table', table.id, `${rule.verb[0].toUpperCase()}${rule.verb.slice(1)} table ${table.tableNumber}`);
    broadcastFloor(table.branchId, table.id);
  }
  return sendResponse(res, true, 'Table updated', { id: table.id, status: result.status });
};

/**
 * POST /orders/:id/move-table { toTableId, wholeTable? } — guests changed
 * tables. Moves the order (or every open order on its table), then puts both
 * tables right. Waiters may move their own orders.
 */
export const moveOrderTable = async (req: AuthRequest, res: Response) => {
  const restaurantId = req.user!.restaurantId;
  const toTableId = String(req.body?.toTableId || '');
  const wholeTable = req.body?.wholeTable !== false;
  const order = await prisma.sale.findFirst({
    where: { id: req.params.id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
    select: { id: true, tableId: true, branchId: true, status: true, orderNumber: true, servedBy: true, createdBy: true },
  });
  if (!order) return sendError(res, 'Order not found', undefined, 404);
  if (!OPEN_ORDER_STATUSES.includes(order.status)) return sendError(res, `A ${order.status.toLowerCase()} order can't be moved`);
  if (!toTableId || toTableId === order.tableId) return sendError(res, 'Choose a different table');
  const target = await prisma.table.findFirst({ where: { id: toTableId, restaurantId, branchId: order.branchId }, select: { id: true, tableNumber: true, status: true } });
  if (!target || target.status === 'INACTIVE') return sendError(res, 'That table is not in this branch');
  if (target.status === 'OUT_OF_SERVICE') return sendError(res, `Table ${target.tableNumber} is out of service`);

  const fromTableId = order.tableId;
  const isWaiter = req.user!.roleName === 'WAITER';
  try {
    const moved = await prisma.$transaction(async (tx) => {
      const ids = wholeTable && fromTableId
        ? (await tx.sale.findMany({ where: { tableId: fromTableId, status: { in: OPEN_ORDER_STATUSES } }, select: { id: true } })).map((s) => s.id)
        : [order.id];
      if (!ids.includes(order.id)) ids.push(order.id);
      // Same lock order as completion and payments: orders first, then tables.
      for (const id of [...ids].sort()) await lockSale(tx, id);
      const sales = await tx.sale.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, tableId: true, servedBy: true, createdBy: true } });
      const movable = sales.filter((s) => OPEN_ORDER_STATUSES.includes(s.status) && s.tableId === fromTableId);
      if (!movable.some((s) => s.id === order.id)) throw new Error('ORDER_CHANGED');
      if (isWaiter && movable.some((s) => (s.servedBy || s.createdBy) !== req.user!.id)) throw new Error('NOT_YOURS');
      await lockTables(tx, [toTableId, ...(fromTableId ? [fromTableId] : [])]);
      const targetNow = await tx.table.findUnique({ where: { id: toTableId }, select: { status: true } });
      if (!targetNow || ['OUT_OF_SERVICE', 'INACTIVE'].includes(targetNow.status)) throw new Error('TARGET_UNAVAILABLE');
      await tx.sale.updateMany({ where: { id: { in: movable.map((s) => s.id) } }, data: { tableId: toTableId } });
      await syncTableStatus(tx, toTableId);
      // The guests got up: the old table needs clearing before the next party.
      await syncTableStatus(tx, fromTableId, 'CLEANING');
      return movable.map((s) => s.id);
    });
    const fromNumber = fromTableId ? (await prisma.table.findUnique({ where: { id: fromTableId }, select: { tableNumber: true } }))?.tableNumber : null;
    await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Order', order.id, `Moved ${moved.length} order(s) from table ${fromNumber || 'none'} to table ${target.tableNumber}`);
    for (const id of moved) realtimeService.broadcast(`orders:${order.branchId}`, 'order_updated', { orderId: id });
    broadcastFloor(order.branchId, toTableId);
    realtimeService.broadcast(`kitchen:${order.branchId}`, 'ticket_status_changed', { orderId: order.id });
    return sendResponse(res, true, `Moved to table ${target.tableNumber}`, { moved, toTableId });
  } catch (err: any) {
    if (err?.message === 'NOT_YOURS') return sendError(res, 'Some orders on this table belong to another waiter. Ask a manager or cashier to move them.', undefined, 403);
    if (err?.message === 'ORDER_CHANGED') return sendError(res, 'This order just changed. Refresh and try again.', undefined, 409);
    if (err?.message === 'TARGET_UNAVAILABLE') return sendError(res, `Table ${target.tableNumber} can't take guests right now`, undefined, 409);
    throw err;
  }
};
