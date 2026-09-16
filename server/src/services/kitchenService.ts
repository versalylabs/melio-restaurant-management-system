import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';
import { completeOrder } from './orderCompletionService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';

export const getKitchenStations = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId;
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

  if (!name || !branchId) {
    return sendError(res, 'Name and branch are required');
  }

  const station = await prisma.kitchenStation.create({
    data: {
      restaurantId,
      branchId,
      name,
      description: description || null,
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

  const station = await prisma.kitchenStation.update({
    where: { id },
    data: {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
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
  const branchId = req.user!.branchId;
  const { status, stationId, startDate, endDate } = req.query;

  const where: any = { restaurantId };
  if (branchId) where.branchId = branchId;
  if (status) where.status = status as string;
  if (stationId) where.stationId = stationId as string;
  if (startDate || endDate) {
    where.receivedAt = {};
    if (startDate) where.receivedAt.gte = new Date(startDate as string);
    if (endDate) where.receivedAt.lte = new Date(endDate as string);
  }

  const tickets = await prisma.kitchenTicket.findMany({
    where,
    orderBy: { receivedAt: 'asc' },
  });

  const result = await Promise.all(
    tickets.map(async (t) => {
      const branch = await prisma.branch.findUnique({ where: { id: t.branchId }, select: { id: true, name: true, code: true } });
      const order = await prisma.sale.findUnique({
        where: { id: t.orderId },
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          tableId: true,
          table: { select: { tableNumber: true, name: true } },
          customerName: true,
          notes: true,
        },
      });
      const station = t.stationId ? await prisma.kitchenStation.findUnique({ where: { id: t.stationId }, select: { id: true, name: true } }) : null;
      const items = await prisma.kitchenTicketItem.findMany({
        where: { ticketId: t.id },
        include: {
          saleItem: { include: { modifiers: true } },
        },
      });
      const itemMenuIds = [...new Set(items.map((item) => item.menuItemId))];
      const itemStationLinks = itemMenuIds.length
        ? await prisma.menuItemStation.findMany({ where: { menuItemId: { in: itemMenuIds }, station: { branchId: t.branchId, status: 'ACTIVE' } }, include: { station: { select: { id: true, name: true } } } })
        : [];
      const stationsByMenuItem = new Map<string, Array<{ id: string; name: string }>>();
      for (const link of itemStationLinks) {
        const current = stationsByMenuItem.get(link.menuItemId) || [];
        current.push(link.station);
        stationsByMenuItem.set(link.menuItemId, current);
      }
      const ticketStationIds = [...new Set(itemStationLinks.map((link) => link.stationId))];
      const ticketStationNames = [...new Set(itemStationLinks.map((link) => link.station.name))];

      return {
        id: t.id,
        restaurantId: t.restaurantId,
        branchId: t.branchId,
        branchName: branch?.name,
        orderId: t.orderId,
        orderNumber: order?.orderNumber,
        orderType: order?.orderType,
        tableId: order?.tableId,
        tableNumber: order?.table?.tableNumber,
        tableName: order?.table?.name,
        customerName: order?.customerName,
        orderNotes: order?.notes,
        stationId: t.stationId,
        stationName: station?.name,
        stationIds: ticketStationIds,
        stationNames: ticketStationNames,
        status: t.status,
        priority: t.priority,
        receivedAt: t.receivedAt,
        startedAt: t.startedAt,
        readyAt: t.readyAt,
        completedAt: t.completedAt,
        items: items.map((item) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          itemNameSnapshot: item.itemNameSnapshot,
          quantity: item.quantity,
          notes: item.notes,
          status: item.status,
          modifiers: item.saleItem.modifiers.map((m) => ({ optionNameSnapshot: m.optionNameSnapshot, priceAdjustment: m.priceAdjustment })),
          stationIds: (stationsByMenuItem.get(item.menuItemId) || []).map((station) => station.id),
          stationNames: (stationsByMenuItem.get(item.menuItemId) || []).map((station) => station.name),
        })),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    })
  );

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
    const result = await tx.sale.update({ where: { id: sale.id }, data: { status: nextStatus, updatedAt: new Date(), ...(nextStatus === 'READY' ? { completedAt: null } : {}) } });
    await tx.saleStatusHistory.create({ data: { saleId: sale.id, status: nextStatus, changedBy: userId, notes: `Kitchen workflow moved order to ${nextStatus}` } });
    return result;
  });

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
  const { id } = req.params;
  const { status, priority } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

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
    if (status === 'ACCEPTED') updateData.startedAt = new Date();
    if (status === 'READY') updateData.readyAt = new Date();
    if (status === 'SERVED' || status === 'COMPLETED') updateData.completedAt = new Date();
  }
  if (priority) updateData.priority = priority;

  // Completing a kitchen ticket must also complete the underlying sale.
  // This keeps the kitchen workflow, order history, inventory and loyalty in sync.
  if (status === 'SERVED' || status === 'COMPLETED') {
    if (ticket.status !== 'READY') {
      return sendError(res, 'Only a READY kitchen ticket can be served/completed');
    }

    try {
      const order = await completeOrder(ticket.orderId, restaurantId, userId);

      const updated = await prisma.kitchenTicket.update({
        where: { id },
        data: { ...updateData, status: status === 'SERVED' ? 'SERVED' : 'COMPLETED', completedAt: new Date() },
      });

      // Realtime event
      realtimeService.broadcast(`kitchen:${ticket.branchId}`, 'ticket_status_changed', {
        ticketId: id,
        orderId: ticket.orderId,
        status: updated.status,
      });

      // If online order exists, notify customer
      const online = await prisma.onlineOrder.findFirst({ where: { saleId: ticket.orderId }, include: { restaurant: true } });
      if (online) {
        await notifyCustomerOrderUpdate({
          trackingToken: online.trackingToken,
          orderNumber: order.orderNumber,
          status: status === 'SERVED' ? 'SERVED' : 'COMPLETED',
          customerPhone: online.contactPhone,
          customerEmail: online.contactEmail,
          restaurantName: online.restaurant?.name || 'Melio',
        });
      }

      await createAuditLog(restaurantId, userId, 'UPDATE', 'KitchenTicket', id, `Ticket ${ticket.id} ${status === 'SERVED' ? 'served' : 'completed'} with order ${order.orderNumber}`);
      return sendResponse(res, true, status === 'SERVED' ? 'Kitchen ticket served and order completed successfully' : 'Kitchen ticket and order completed successfully', updated);
    } catch (error: any) {
      if (error?.message === 'ORDER_NOT_FOUND') return sendError(res, 'The order linked to this kitchen ticket was not found', undefined, 404);
      if (error?.message === 'ORDER_CANCELLED') return sendError(res, 'A cancelled order cannot be completed');
      console.error('Complete kitchen ticket failed:', error);
      return sendError(res, 'Unable to complete the kitchen ticket.', undefined, 500);
    }
  }

  const updated = await prisma.kitchenTicket.update({
    where: { id },
    data: updateData,
  });

  // Realtime event
  realtimeService.broadcast(`kitchen:${ticket.branchId}`, 'ticket_status_changed', {
    ticketId: id,
    orderId: ticket.orderId,
    status: updated.status,
  });

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
};

export const updateKitchenTicketItemStatus = async (req: AuthRequest, res: ExpressResponse) => {
  const { ticketId, itemId } = req.params;
  const { status } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

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
  // Synchronize the parent sale so the customer's tracking page updates too.
  if (ticketStatusChanged) {
    try {
      await syncSaleStatusFromKitchen(ticket.orderId, restaurantId, userId);
    } catch (syncErr) {
      console.error('Kitchen item/order status synchronization failed:', syncErr);
    }
  }

  await createAuditLog(restaurantId, userId, 'UPDATE', 'KitchenTicketItem', itemId, `Item ${item.itemNameSnapshot} status changed to ${status}`);
  return sendResponse(res, true, 'Kitchen ticket item updated successfully');
};

export const createKitchenTicketForOrder = async (orderId: string, restaurantId: string, branchId: string) => {
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
