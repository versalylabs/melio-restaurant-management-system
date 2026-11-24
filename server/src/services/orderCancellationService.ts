import prisma from '../config/database';
import { blockingPaymentsForCancel, lockSale } from './saleLedgerService';
import { syncTableStatus } from './tableFloorService';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';

/** Statuses in which the kitchen has not been sent the order yet. */
export const NOT_FIRED_STATUSES = ['DRAFT', 'HELD'];

const ACTIVE_TABLE_ORDER_STATUSES = ['DRAFT', 'HELD', 'SUBMITTED', 'PREPARING', 'READY', 'SERVED'];

export class OrderCancelError extends Error {
  constructor(public code: 'ORDER_NOT_FOUND' | 'ORDER_CLOSED' | 'ORDER_HAS_PAYMENTS' | 'MPESA_IN_FLIGHT' | 'APPROVAL_REQUIRED' | 'REASON_REQUIRED', message: string, public statusCode = 400) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * The one way to cancel an order (Orders page, status endpoint, POS).
 *
 * Under the order lock it refuses when money has been taken (refund first)
 * or an M-Pesa prompt is still in flight, then cancels the sale, frees the
 * table, and cancels the kitchen ticket so the cooks stop. Afterwards it
 * tells the kitchen display, the orders screen and the online customer.
 */
export async function cancelOrderSafely(params: {
  orderId: string;
  restaurantId: string;
  /** Restrict to this branch (staff tied to a branch). */
  branchId?: string | null;
  userId: string;
  reason?: string | null;
  /**
   * Manager who approved by PIN. Once the kitchen has the order a cancel is a
   * void: it needs an approver and a reason, and is written to the void log.
   */
  approvedBy?: string | null;
}) {
  const { orderId, restaurantId, branchId, userId } = params;
  const reason = params.reason ? String(params.reason).trim().slice(0, 500) : null;

  const order = await prisma.$transaction(async (tx) => {
    if (!(await lockSale(tx, orderId))) throw new OrderCancelError('ORDER_NOT_FOUND', 'Order not found', 404);
    const existing = await tx.sale.findFirst({ where: { id: orderId, restaurantId, ...(branchId ? { branchId } : {}) } });
    if (!existing) throw new OrderCancelError('ORDER_NOT_FOUND', 'Order not found', 404);
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new OrderCancelError('ORDER_CLOSED', `Cannot cancel ${existing.status.toLowerCase()} order`);
    }

    const { paidAmount, mpesaInFlight } = await blockingPaymentsForCancel(tx, orderId);
    if (paidAmount > 0.005) {
      throw new OrderCancelError('ORDER_HAS_PAYMENTS', `This order has ${paidAmount.toFixed(2)} in payments. Refund them before cancelling.`, 409);
    }
    if (mpesaInFlight) {
      throw new OrderCancelError('MPESA_IN_FLIGHT', 'An M-Pesa payment for this order is still in progress. Wait a few minutes and try again.', 409);
    }

    const fired = !NOT_FIRED_STATUSES.includes(existing.status);
    if (fired && !reason) {
      throw new OrderCancelError('REASON_REQUIRED', 'Give a reason for cancelling an order the kitchen already has.');
    }
    if (fired && !params.approvedBy) {
      throw new OrderCancelError('APPROVAL_REQUIRED', "The kitchen already has this order. A manager's approval is needed to cancel it.", 428);
    }

    const now = new Date();
    const updated = await tx.sale.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason, cancelledBy: userId, updatedAt: now },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: { include: { modifiers: true } },
      },
    });

    // Abandon payment placeholders that never reached a provider. Pending
    // payments WITH a provider reference (an M-Pesa prompt that was sent) stay
    // PENDING: if Safaricom later confirms them, the money is recorded and
    // flagged for a refund instead of being lost.
    await tx.payment.updateMany({ where: { saleId: orderId, status: 'PENDING', reference: null }, data: { status: 'CANCELLED' } });

    // Only an order the kitchen had kept the table occupied; a held order
    // being dropped says nothing about guests who are seated there.
    if (existing.tableId && fired) await syncTableStatus(tx, existing.tableId, 'AVAILABLE');

    const tickets = await tx.kitchenTicket.findMany({
      where: { orderId, status: { notIn: ['SERVED', 'COMPLETED', 'CANCELLED'] } },
      select: { id: true, branchId: true },
    });
    if (tickets.length) {
      await tx.kitchenTicket.updateMany({ where: { id: { in: tickets.map((t) => t.id) } }, data: { status: 'CANCELLED' } });
      await tx.kitchenTicketItem.updateMany({ where: { ticketId: { in: tickets.map((t) => t.id) }, status: { notIn: ['SERVED', 'COMPLETED'] } }, data: { status: 'CANCELLED' } });
    }

    if (fired) {
      await tx.voidRecord.create({
        data: {
          restaurantId: existing.restaurantId,
          branchId: existing.branchId,
          saleId: orderId,
          kind: 'ORDER',
          itemName: `Order ${existing.orderNumber}`,
          quantity: 1,
          value: existing.totalAmount,
          reason: reason!,
          firedToKitchen: true,
          requestedBy: userId,
          approvedBy: params.approvedBy || null,
        },
      });
    }

    await tx.saleStatusHistory.create({
      data: { saleId: orderId, status: 'CANCELLED', notes: reason || 'Order cancelled', changedBy: userId },
    });

    return { updated, tickets };
  });

  const sale = order.updated;
  realtimeService.broadcast(`orders:${sale.branch.id}`, 'order_status_updated', { orderId: sale.id, orderNumber: sale.orderNumber, status: 'CANCELLED' });
  for (const t of order.tickets) {
    realtimeService.broadcast(`kitchen:${t.branchId}`, 'ticket_status_changed', { ticketId: t.id, orderId: sale.id, status: 'CANCELLED' });
  }
  const online = await prisma.onlineOrder.findFirst({ where: { saleId: sale.id }, include: { restaurant: true } });
  if (online) {
    void notifyCustomerOrderUpdate({
      trackingToken: online.trackingToken,
      orderNumber: sale.orderNumber,
      status: 'CANCELLED',
      customerPhone: online.contactPhone,
      customerEmail: online.contactEmail,
      restaurantName: online.restaurant?.name || 'Melio',
      totalAmount: sale.totalAmount,
    }).catch((err) => console.error('Cancellation customer notification failed:', err));
  }
  return sale;
}
