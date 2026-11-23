import prisma from '../config/database';
import { deductInventoryForOrderSafely } from './inventoryService';
import { lockSale } from './saleLedgerService';
import { realtimeService } from './realtimeService';

/**
 * Completes a sale from any workflow (POS/order management or kitchen).
 * Keeps the sale, status history, inventory and loyalty side-effects in sync.
 */
export const completeOrder = async (orderId: string, restaurantId: string, userId: string) => {
  const existing = await prisma.sale.findFirst({
    where: { id: orderId, restaurantId },
    include: { items: true },
  });

  if (!existing) {
    throw new Error('ORDER_NOT_FOUND');
  }

  // Idempotent: a completed order should never be completed/awarded twice.
  if (existing.status === 'COMPLETED') {
    return existing;
  }

  if (existing.status === 'CANCELLED') {
    throw new Error('ORDER_CANCELLED');
  }

  const order = await prisma.$transaction(async (tx) => {
    await lockSale(tx, orderId);
    const current = await tx.sale.findUnique({ where: { id: orderId } });
    if (!current) throw new Error('ORDER_NOT_FOUND');
    if (current.status === 'COMPLETED') return current;
    if (current.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

    const completedAt = new Date();

    if (current.tableId) {
      const remainingActive = await tx.sale.count({
        where: {
          tableId: current.tableId,
          id: { not: orderId },
          status: { in: ['DRAFT', 'HELD', 'SUBMITTED', 'PREPARING', 'READY', 'SERVED'] },
        },
      });
      if (remainingActive === 0) {
        await tx.table.update({
          where: { id: current.tableId },
          data: { status: 'CLEANING' },
        });
      }
    }

    const updated = await tx.sale.update({
      where: { id: orderId },
      data: {
        status: 'COMPLETED',
        completedAt,
        updatedAt: completedAt,
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, tableNumber: true, name: true } },
        items: { include: { modifiers: true } },
      },
    });

    await tx.saleStatusHistory.create({
      data: {
        saleId: orderId,
        status: 'COMPLETED',
        notes: 'Order completed',
        changedBy: userId,
      },
    });

    return updated;
  });

  // Inventory and loyalty are intentionally kept outside the sale transaction,
  // matching the existing order-completion behavior. Both operations are
  // idempotent/guarded so completing through the kitchen cannot double-apply them.
  await deductInventoryForOrderSafely(orderId, restaurantId, existing.branchId);

  if (existing.customerId) {
    const points = Math.floor(order.totalAmount / 100);
    if (points > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          const existingAward = await tx.loyaltyTransaction.findFirst({
            where: { customerId: existing.customerId!, orderId, type: 'EARN' },
            select: { id: true },
          });
          if (existingAward) return;

          await tx.customer.update({
            where: { id: existing.customerId! },
            data: { loyaltyBalance: { increment: points } },
          });

          await tx.loyaltyTransaction.create({
            data: {
              restaurantId,
              customerId: existing.customerId!,
              orderId,
              points,
              type: 'EARN',
              note: `Earned from completed order ${order.orderNumber}`,
            },
          });
        });
      } catch (error) {
        console.error('Loyalty award failed:', error);
      }
    }
  }

  return order;
};

const SERVE_PATH = ['SUBMITTED', 'PREPARING', 'READY', 'SERVED'];

/**
 * The kitchen has handed the food over. The kitchen never closes a sale:
 * - dine-in / pickup / takeaway orders move to SERVED (walking through any
 *   steps the kitchen skipped), delivery orders to READY for the rider;
 * - stock is deducted once the food is served;
 * - an order that is SERVED and already fully paid is completed.
 * Throws ORDER_CANCELLED if the order was cancelled meanwhile.
 */
export const markSaleServedFromKitchen = async (orderId: string, restaurantId: string, userId: string) => {
  const outcome = await prisma.$transaction(async (tx) => {
    if (!(await lockSale(tx, orderId))) throw new Error('ORDER_NOT_FOUND');
    const sale = await tx.sale.findFirst({ where: { id: orderId, restaurantId } });
    if (!sale) throw new Error('ORDER_NOT_FOUND');
    if (sale.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

    const target = sale.orderType === 'DELIVERY' ? 'READY' : 'SERVED';
    const from = SERVE_PATH.indexOf(sale.status);
    const to = SERVE_PATH.indexOf(target);
    // Already at/after the target (or COMPLETED / OUT_FOR_DELIVERY): nothing to move.
    if (['COMPLETED', 'OUT_FOR_DELIVERY'].includes(sale.status) || from >= to) return { sale, changed: false };

    const steps = SERVE_PATH.slice(Math.max(from, 0) + 1, to + 1);
    for (const step of steps) {
      await tx.saleStatusHistory.create({ data: { saleId: orderId, status: step, changedBy: userId, notes: `Kitchen workflow moved order to ${step}` } });
    }
    const updated = await tx.sale.update({ where: { id: orderId }, data: { status: target, updatedAt: new Date() } });
    return { sale: updated, changed: true };
  });

  let sale = outcome.sale;
  if (outcome.changed) {
    realtimeService.broadcast(`orders:${sale.branchId}`, 'order_status_updated', { orderId: sale.id, orderNumber: sale.orderNumber, status: sale.status });
  }
  if (sale.status === 'SERVED' && sale.paymentStatus === 'PAID') {
    sale = await completeOrder(orderId, restaurantId, userId);
  } else if (sale.status === 'SERVED') {
    await deductInventoryForOrderSafely(orderId, restaurantId, sale.branchId);
  }
  return sale;
};
