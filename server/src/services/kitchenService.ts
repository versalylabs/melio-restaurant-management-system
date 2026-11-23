import prisma from '../config/database';
import { safeErrorMessage } from '../utils/safeError';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';
import { markSaleServedFromKitchen } from './orderCompletionService';
import { lockSale } from './saleLedgerService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';
import { boundedLimit } from '../utils/pagination';

export const getKitchenStations = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = (req.query.branchId as string) || req.user!.branchId;
  const { status } = req.query;

  const where: any = { restaurantId };
  if (branchId) where.branchId = branchId;
  if (status) where.status = status as string;

  const stations = await prisma.kitchenStation.findMany({
    where,
    orderBy: { displayOrder: 'asc' },
  });

  const result = await Promise.all(
    stations.map(async (s) => {
      const branch = await prisma.branch.findUnique({ where: { id: s.branchId }, select: { id: true, name: true, code: true } });
      const menuItemCount = await prisma.menuItemStation.count({ where: { stationId: s.id } });
      const ticketCount = await prisma.kitchenTicket.count({ where: { stationId: s.id, status: { not: 'COMPLETED' } } });
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        displayOrder: s.displayOrder,
        status: s.status,
        branchId: s.branchId,
        branchName: branch?.name,
        menuItemCount,
        ticketCount,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    })
  );

  return sendResponse(res, true, 'Kitchen stations retrieved', { stations: result });
};

export const getKitchenStation = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const station = await prisma.kitchenStation.findFirst({ where: { id, restaurantId } });
  if (!station) {
    return sendError(res, 'Kitchen station not found', undefined, 404);
  }

  const menuItemStations = await prisma.menuItemStation.findMany({
    where: { stationId: id },
    include: { menuItem: { select: { id: true, name: true, sellingPrice: true } } },
  });

  return sendResponse(res, true, 'Kitchen station retrieved', {
    ...station,
    menuItems: menuItemStations.map((m) => m.menuItem),
  });
};

export const createKitchenStation = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;
  const { name, description, displayOrder, status, branchId } = req.body;

  const trimmedName = name ? String(name).trim() : '';
  if (!trimmedName || !branchId) {
    return sendError(res, 'Station name and branch are required');
  }

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) {
    return sendError(res, 'Invalid branch');
  }

  const existingStations = await prisma.kitchenStation.findMany({
    where: {
      branchId,
      restaurantId,
      status: { not: 'INACTIVE' },
    },
    select: { id: true, name: true },
  });
  if (existingStations.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())) {
    return sendError(res, 'A kitchen station with this name already exists in this branch', undefined, 409);
  }

  const station = await prisma.kitchenStation.create({
    data: {
      restaurantId,
      branchId,
      name: trimmedName,
      description: description ? String(description).trim() : null,
      displayOrder: displayOrder || 0,
      status: status || 'ACTIVE',
    },
  });

  await createAuditLog(restaurantId, userId, 'CREATE', 'KitchenStation', station.id, `Created kitchen station ${station.name}`);
  return sendResponse(res, true, 'Kitchen station created successfully', station, 201);
};

export const updateKitchenStation = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.kitchenStation.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Kitchen station not found', undefined, 404);
  }

  const { name, description, displayOrder, status } = req.body;

  let trimmedName = existing.name;
  if (name !== undefined) {
    trimmedName = String(name).trim();
    if (!trimmedName) return sendError(res, 'Station name cannot be empty');
    const existingStations = await prisma.kitchenStation.findMany({
      where: {
        branchId: existing.branchId,
        restaurantId,
        id: { not: id },
        status: { not: 'INACTIVE' },
      },
      select: { id: true, name: true },
    });
    if (existingStations.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())) {
      return sendError(res, 'A kitchen station with this name already exists in this branch', undefined, 409);
    }
  }

  const station = await prisma.kitchenStation.update({
    where: { id },
    data: {
      name: trimmedName,
      description: description !== undefined ? (description ? String(description).trim() : null) : existing.description,
      displayOrder: displayOrder !== undefined ? displayOrder : existing.displayOrder,
      status: status || existing.status,
    },
  });

  await createAuditLog(restaurantId, userId, 'UPDATE', 'KitchenStation', id, `Updated kitchen station ${station.name}`);
  return sendResponse(res, true, 'Kitchen station updated successfully', station);
};

export const deleteKitchenStation = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.kitchenStation.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Kitchen station not found', undefined, 404);
  }

  const activeTicketCount = await prisma.kitchenTicket.count({
    where: { stationId: id, status: { in: ['SUBMITTED', 'PREPARING'] } },
  });
  if (activeTicketCount > 0) {
    return sendError(res, `Cannot deactivate kitchen station with ${activeTicketCount} active ticket(s)`, undefined, 400);
  }

  await prisma.kitchenStation.update({
    where: { id },
    data: { status: 'INACTIVE' },
  });

  await createAuditLog(restaurantId, userId, 'DELETE', 'KitchenStation', id, `Deactivated kitchen station ${existing.name}`);
  return sendResponse(res, true, 'Kitchen station deactivated successfully');
};

export const assignMenuItemToStation = async (req: AuthRequest, res: ExpressResponse) => {
  const { stationId } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;
  const { menuItemId } = req.body;

  const station = await prisma.kitchenStation.findFirst({ where: { id: stationId, restaurantId } });
  if (!station) {
    return sendError(res, 'Kitchen station not found', undefined, 404);
  }

  const menuItem = await prisma.menuItem.findFirst({ where: { id: menuItemId, restaurantId } });
  if (!menuItem) {
    return sendError(res, 'Menu item not found', undefined, 404);
  }

  const existing = await prisma.menuItemStation.findFirst({ where: { menuItemId, stationId } });
  if (!existing) {
    await prisma.menuItemStation.create({ data: { menuItemId, stationId } });
  }

  await createAuditLog(restaurantId, userId, 'UPDATE', 'MenuItemStation', stationId, `Assigned ${menuItem.name} to ${station.name}`);
  return sendResponse(res, true, 'Menu item assigned to station successfully');
};

export const removeMenuItemFromStation = async (req: AuthRequest, res: ExpressResponse) => {
  const { stationId, menuItemId } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const station = await prisma.kitchenStation.findFirst({ where: { id: stationId, restaurantId } });
  if (!station) {
    return sendError(res, 'Kitchen station not found', undefined, 404);
  }

  await prisma.menuItemStation.deleteMany({ where: { menuItemId, stationId } });

  await createAuditLog(restaurantId, userId, 'UPDATE', 'MenuItemStation', stationId, `Removed menu item from ${station.name}`);
  return sendResponse(res, true, 'Menu item removed from station successfully');
};

export const getKitchenTickets = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = (req.query.branchId as string) || req.user!.branchId;
  const { status, stationId, startDate, endDate } = req.query;

  const where: any = { restaurantId };
  if (branchId) where.branchId = branchId;
  if (status) where.status = status as string;
  // With no filter, the kitchen only needs open tickets (NEW/PREPARING/READY),
  // not every ticket ever served. Tickets for cancelled orders are never work.
  else if (startDate || endDate) where.status = { not: 'CANCELLED' };
  else where.status = { notIn: ['SERVED', 'COMPLETED', 'CANCELLED'] };
  const openTicketsOnly = !status && !startDate && !endDate;
  // An order that was closed without the kitchen pressing "Served" leaves its
  // ticket open; it is not work any more, so the default view skips it.
  if (openTicketsOnly) where.order = { status: { notIn: ['CANCELLED', 'COMPLETED'] } };
  else if (status !== 'CANCELLED') where.order = { status: { not: 'CANCELLED' } };
  if (stationId) where.stationId = stationId as string;
  if (startDate || endDate) {
    where.receivedAt = {};
    if (startDate) where.receivedAt.gte = new Date(startDate as string);
    if (endDate) where.receivedAt.lte = new Date(endDate as string);
  }

  // Keep the newest tickets when capped (so new orders always appear), then
  // show them oldest first as before.
  const tickets = await prisma.kitchenTicket.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: boundedLimit(req.query.limit, 300, 1000),
    include: {
      branch: { select: { id: true, name: true, code: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          tableId: true,
          table: { select: { tableNumber: true, name: true } },
          customerName: true,
          notes: true,
        },
      },
      station: { select: { id: true, name: true } },
      items: {
        include: {
          saleItem: { include: { modifiers: true } },
        },
      },
    },
  });
  tickets.reverse();

  const allItemMenuIds = [...new Set(tickets.flatMap((t) => t.items.map((i) => i.menuItemId)))];
  const allStationLinks = allItemMenuIds.length
    ? await prisma.menuItemStation.findMany({
        where: { menuItemId: { in: allItemMenuIds }, station: { status: 'ACTIVE' } },
        include: { station: { select: { id: true, name: true, branchId: true } } },
      })
    : [];

  const stationsByMenuItemAndBranch = new Map<string, Array<{ id: string; name: string }>>();
  for (const link of allStationLinks) {
    const key = `${link.menuItemId}::${link.station.branchId}`;
    const list = stationsByMenuItemAndBranch.get(key) || [];
    list.push(link.station);
    stationsByMenuItemAndBranch.set(key, list);
  }

  const result = tickets.map((t) => {
    const itemStationLinks = t.items.flatMap((item) => stationsByMenuItemAndBranch.get(`${item.menuItemId}::${t.branchId}`) || []);
    const ticketStationIds = [...new Set(itemStationLinks.map((s) => s.id))];
    const ticketStationNames = [...new Set(itemStationLinks.map((s) => s.name))];

    return {
      id: t.id,
      restaurantId: t.restaurantId,
      branchId: t.branchId,
      branchName: t.branch?.name,
      orderId: t.orderId,
      orderNumber: t.order?.orderNumber,
      orderType: t.order?.orderType,
      tableId: t.order?.tableId,
      tableNumber: t.order?.table?.tableNumber,
      tableName: t.order?.table?.name,
      customerName: t.order?.customerName,
      orderNotes: t.order?.notes,
      stationId: t.stationId,
      stationName: t.station?.name,
      stationIds: ticketStationIds,
      stationNames: ticketStationNames,
      status: t.status,
      priority: t.priority,
      receivedAt: t.receivedAt,
      startedAt: t.startedAt,
      readyAt: t.readyAt,
      completedAt: t.completedAt,
      items: t.items.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        itemNameSnapshot: item.itemNameSnapshot,
        quantity: item.quantity,
        notes: item.notes,
        status: item.status,
        modifiers: item.saleItem?.modifiers ? item.saleItem.modifiers.map((m) => ({ optionNameSnapshot: m.optionNameSnapshot, priceAdjustment: m.priceAdjustment })) : [],
        stationIds: (stationsByMenuItemAndBranch.get(`${item.menuItemId}::${t.branchId}`) || []).map((s) => s.id),
        stationNames: (stationsByMenuItemAndBranch.get(`${item.menuItemId}::${t.branchId}`) || []).map((s) => s.name),
      })),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });

  return sendResponse(res, true, 'Kitchen tickets retrieved', { tickets: result });
};

export const getKitchenTicket = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const ticket = await prisma.kitchenTicket.findFirst({ where: { id, restaurantId } });
  if (!ticket) {
    return sendError(res, 'Kitchen ticket not found', undefined, 404);
  }

  const branch = await prisma.branch.findUnique({ where: { id: ticket.branchId }, select: { id: true, name: true, code: true } });
  const order = await prisma.sale.findUnique({
    where: { id: ticket.orderId },
    include: {
      table: { select: { tableNumber: true, name: true } },
      items: { include: { modifiers: true } },
    },
  });
  const station = ticket.stationId ? await prisma.kitchenStation.findUnique({ where: { id: ticket.stationId } }) : null;
  const items = await prisma.kitchenTicketItem.findMany({
    where: { ticketId: id },
    include: {
      saleItem: { include: { modifiers: true } },
    },
  });

  return sendResponse(res, true, 'Kitchen ticket retrieved', {
    ...ticket,
    branch,
    order,
    station,
    items,
  });
};

async function syncSaleStatusFromKitchen(orderId: string, restaurantId: string, userId: string) {
  const sale = await prisma.sale.findFirst({ where: { id: orderId, restaurantId }, select: { id: true, status: true, orderNumber: true, branchId: true } });
  if (!sale || ['CANCELLED', 'COMPLETED'].includes(sale.status)) return null;

  const tickets = await prisma.kitchenTicket.findMany({
    where: { orderId, restaurantId },
    select: { status: true },
  });
  if (!tickets.length) return null;

  const ticketStatuses = tickets.map((t) => t.status);
  const nextStatus = ticketStatuses.every((value) => ['READY', 'SERVED', 'COMPLETED'].includes(value))
    ? 'READY'
    : ticketStatuses.some((value) => ['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'].includes(value))
      ? 'PREPARING'
      : null;

  if (!nextStatus || sale.status === nextStatus) return null;

  const transitionAllowed = sale.status === 'SUBMITTED' && nextStatus === 'PREPARING'
    || sale.status === 'PREPARING' && nextStatus === 'READY';
  if (!transitionAllowed) return null;

  const updated = await prisma.$transaction(async (tx) => {
    // Re-check under the order lock: a cashier may have just cancelled or completed it.
    await lockSale(tx, sale.id);
    const moved = await tx.sale.updateMany({ where: { id: sale.id, status: sale.status }, data: { status: nextStatus, updatedAt: new Date(), ...(nextStatus === 'READY' ? { completedAt: null } : {}) } });
    if (moved.count === 0) return null;
    const result = await tx.sale.findUniqueOrThrow({ where: { id: sale.id } });
    await tx.saleStatusHistory.create({ data: { saleId: sale.id, status: nextStatus, changedBy: userId, notes: `Kitchen workflow moved order to ${nextStatus}` } });
    return result;
  });
  if (!updated) return null;

  realtimeService.broadcast(`orders:${sale.branchId}`, 'order_status_updated', { orderId: sale.id, orderNumber: sale.orderNumber, status: nextStatus });

  const online = await prisma.onlineOrder.findFirst({ where: { saleId: sale.id }, include: { restaurant: true } });
  if (online) {
    await notifyCustomerOrderUpdate({
      trackingToken: online.trackingToken,
      orderNumber: sale.orderNumber,
      status: nextStatus,
      customerPhone: online.contactPhone,
      customerEmail: online.contactEmail,
      restaurantName: online.restaurant?.name || 'Melio',
    });
  }

  return updated;
}

export const updateKitchenTicketStatus = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.body;
    const restaurantId = req.user?.restaurantId;
    const userId = req.user?.id || 'system';

    if (!restaurantId) {
      return sendError(res, 'Authentication required', undefined, 401);
    }

    const validStatuses = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const ticket = await prisma.kitchenTicket.findFirst({ where: { id, restaurantId } });
    if (!ticket) {
      return sendError(res, 'Kitchen ticket not found', undefined, 404);
    }

    const updateData: any = {};
    if (status) {
      updateData.status = status;
      if (status === 'ACCEPTED' || status === 'PREPARING') updateData.startedAt = ticket.startedAt || new Date();
      if (status === 'READY') updateData.readyAt = ticket.readyAt || new Date();
      if (status === 'SERVED' || status === 'COMPLETED') updateData.completedAt = ticket.completedAt || new Date();
    }
    if (priority) updateData.priority = priority;

    // Serving from the kitchen moves the order to SERVED (READY for delivery);
    // it never closes the sale. The sale completes once it is fully paid.
    if (status === 'SERVED' || status === 'COMPLETED') {
      let sale: any;
      try {
        sale = await markSaleServedFromKitchen(ticket.orderId, restaurantId, userId);
      } catch (err: any) {
        if (err?.message === 'ORDER_CANCELLED') return sendError(res, 'This order was cancelled. Remove the ticket instead of serving it.', undefined, 409);
        if (err?.message === 'ORDER_NOT_FOUND') return sendError(res, 'Order for this ticket was not found', undefined, 404);
        throw err;
      }

      const updated = await prisma.kitchenTicket.update({
        where: { id },
        data: { ...updateData, status, completedAt: ticket.completedAt || new Date() },
      });
      await prisma.kitchenTicketItem.updateMany({
        where: { ticketId: id, status: { in: ['PENDING', 'PREPARING', 'READY'] } },
        data: { status: 'SERVED' },
      }).catch(() => undefined);

      realtimeService.broadcast(`kitchen:${ticket.branchId}`, 'ticket_status_changed', { ticketId: id, orderId: ticket.orderId, status: updated.status });

      try {
        const online = await prisma.onlineOrder.findFirst({ where: { saleId: ticket.orderId }, include: { restaurant: true } });
        if (online) {
          await notifyCustomerOrderUpdate({
            trackingToken: online.trackingToken,
            orderNumber: sale.orderNumber,
            status: sale.status,
            customerPhone: online.contactPhone,
            customerEmail: online.contactEmail,
            restaurantName: online.restaurant?.name || 'Melio',
          });
        }
      } catch (err) {
        console.error('Customer notification after serving failed:', err);
      }

      await createAuditLog(restaurantId, userId, 'UPDATE', 'KitchenTicket', id, `Ticket for order ${sale.orderNumber} marked ${status}; order is now ${sale.status}`);
      return sendResponse(res, true, sale.status === 'COMPLETED' ? 'Order served and closed (already paid)' : `Order served; it is now ${sale.status}`, updated);
    }

    const updated = await prisma.kitchenTicket.update({
      where: { id },
      data: updateData,
    });

    // Also update ticket items status to match ticket workflow
    if (status === 'PREPARING') {
      try {
        await prisma.kitchenTicketItem.updateMany({
          where: { ticketId: id, status: 'PENDING' },
          data: { status: 'PREPARING' },
        });
      } catch {}
    } else if (status === 'READY') {
      try {
        await prisma.kitchenTicketItem.updateMany({
          where: { ticketId: id, status: { in: ['PENDING', 'PREPARING'] } },
          data: { status: 'READY' },
        });
      } catch {}
    }

    // Realtime event
    try {
      realtimeService.broadcast(`kitchen:${ticket.branchId}`, 'ticket_status_changed', {
        ticketId: id,
        orderId: ticket.orderId,
        status: updated.status,
      });
    } catch {}

    // Keep the customer-facing order stage synchronized with the kitchen workflow.
    if (status === 'PREPARING' || status === 'READY') {
      try {
        await syncSaleStatusFromKitchen(ticket.orderId, restaurantId, userId);
      } catch (syncErr) {
        console.error('Kitchen/order status synchronization failed:', syncErr);
      }
    }

    await createAuditLog(restaurantId, userId, 'UPDATE', 'KitchenTicket', id, `Ticket ${ticket.id} status changed to ${status || ticket.status}`);
    return sendResponse(res, true, 'Kitchen ticket updated successfully', updated);
  } catch (err: any) {
    console.error('updateKitchenTicketStatus error:', err);
    return sendError(res, safeErrorMessage(err, 'Failed to update kitchen ticket'), undefined, 500);
  }
};

export const updateKitchenTicketItemStatus = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { ticketId, itemId } = req.params;
    const { status } = req.body;
    const restaurantId = req.user?.restaurantId;
    const userId = req.user?.id || 'system';

    if (!restaurantId) {
      return sendError(res, 'Authentication required', undefined, 401);
    }

    const validStatuses = ['PENDING', 'PREPARING', 'READY', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return sendError(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const ticket = await prisma.kitchenTicket.findFirst({
      where: { id: ticketId, restaurantId },
    });
    if (!ticket) {
      return sendError(res, 'Kitchen ticket not found', undefined, 404);
    }

    const item = await prisma.kitchenTicketItem.findFirst({
      where: { id: itemId, ticketId },
    });
    if (!item) {
      return sendError(res, 'Kitchen ticket item not found', undefined, 404);
    }

    await prisma.kitchenTicketItem.update({
      where: { id: itemId },
      data: { status },
    });

    const allItems = await prisma.kitchenTicketItem.findMany({ where: { ticketId } });
    const allReady = allItems.every((i) => i.status === 'READY' || i.status === 'CANCELLED');
    const anyPreparing = allItems.some((i) => i.status === 'PREPARING');

    let ticketStatusChanged = false;
    if (allReady && ticket.status !== 'READY' && ticket.status !== 'COMPLETED') {
      await prisma.kitchenTicket.update({
        where: { id: ticketId },
        data: { status: 'READY', readyAt: new Date() },
      });
      ticketStatusChanged = true;
    } else if (anyPreparing && ticket.status === 'NEW') {
      await prisma.kitchenTicket.update({
        where: { id: ticketId },
        data: { status: 'PREPARING', startedAt: new Date() },
      });
      ticketStatusChanged = true;
    }

    // Item-level KDS actions also change the ticket's operational state.
    if (ticketStatusChanged) {
      try {
        await syncSaleStatusFromKitchen(ticket.orderId, restaurantId, userId);
      } catch (syncErr) {
        console.error('Kitchen item/order status synchronization failed:', syncErr);
      }
    }

    await createAuditLog(restaurantId, userId, 'UPDATE', 'KitchenTicketItem', itemId, `Item ${item.itemNameSnapshot} status changed to ${status}`);
    return sendResponse(res, true, 'Kitchen ticket item updated successfully');
  } catch (err: any) {
    console.error('updateKitchenTicketItemStatus error:', err);
    return sendError(res, safeErrorMessage(err, 'Failed to update item status'), undefined, 500);
  }
};

export const createKitchenTicketForOrder = async (orderId: string, restaurantId: string, branchId: string): Promise<any> => {
  try {
    return await createKitchenTicketForOrderOnce(orderId, restaurantId, branchId);
  } catch (err: any) {
    // Two callers (e.g. an M-Pesa callback and a cashier) raced to create the
    // same ticket; the unique (orderId, branchId) index kept one. Return it.
    if (err?.code === 'P2002') {
      const existing = await prisma.kitchenTicket.findFirst({ where: { orderId, branchId } });
      if (existing) return existing;
    }
    throw err;
  }
};

const createKitchenTicketForOrderOnce = async (orderId: string, restaurantId: string, branchId: string) => {
  const existing = await prisma.kitchenTicket.findFirst({ where: { orderId, branchId } });
  if (existing) {
    return existing;
  }

  const order = await prisma.sale.findFirst({
    where: { id: orderId, restaurantId },
    include: {
      items: true,
    },
  });

  if (!order || order.status === 'DRAFT' || order.status === 'HELD' || order.status === 'CANCELLED') {
    return null;
  }

  const ticket = await prisma.kitchenTicket.create({
    data: {
      restaurantId,
      branchId,
      orderId,
      stationId: null,
      status: 'NEW',
      priority: 'NORMAL',
      items: {
        create: order.items.map((item) => ({
          saleItemId: item.id,
          menuItemId: item.menuItemId,
          itemNameSnapshot: item.itemNameSnapshot,
          quantity: item.quantity,
          notes: item.notes || null,
          status: 'PENDING',
        })),
      },
    },
  });

  // Station routing is derived per ticket item. A single order can legitimately use multiple stations.
  // Keep the legacy ticket.stationId null for multi-station orders; the display resolves station membership per item.

  try {
    await createAuditLog(restaurantId, 'system', 'CREATE', 'KitchenTicket', ticket.id, `Created kitchen ticket for order ${order.orderNumber}`);
  } catch {
    // Audit log failure should not break order creation
  }
  return ticket;
};
