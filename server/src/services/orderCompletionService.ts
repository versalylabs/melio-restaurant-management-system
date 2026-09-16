import prisma from '../config/database';
import { deductInventoryForOrder } from './inventoryService';

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
    const current = await tx.sale.findUnique({ where: { id: orderId } });
    if (!current) throw new Error('ORDER_NOT_FOUND');
    if (current.status === 'COMPLETED') return current;
    if (current.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

    const completedAt = new Date();

    if (current.tableId) {
      await tx.table.update({
        where: { id: current.tableId },
        data: { status: 'CLEANING' },
      });
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
        notes: 'Order completed from kitchen workflow',
        changedBy: userId,
      },
    });

    return updated;
  });

  // Inventory and loyalty are intentionally kept outside the sale transaction,
  // matching the existing order-completion behavior. Both operations are
  // idempotent/guarded so completing through the kitchen cannot double-apply them.
  try {
    await deductInventoryForOrder(orderId, restaurantId, existing.branchId);
  } catch (error) {
    console.error('Inventory deduction failed:', error);
  }

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
