import { afterResponse, sendSms } from './smsService';
import { receiptSms, smsLanguage } from './smsTemplates';
import { syncTableStatus } from './tableFloorService';
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

    // Last bill at the table closed: it needs clearing (out of service stays so).
    await syncTableStatus(tx, current.tableId, 'CLEANING');

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
    // Receipt and points by SMS, for customers who asked for it at the till.
    afterResponse(sendReceiptSms(orderId, existing.customerId, restaurantId, order.orderNumber, order.totalAmount));
  }

  realtimeService.broadcast(`orders:${existing.branchId}`, 'order_status_updated', { orderId, status: 'COMPLETED' });
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

async function sendReceiptSms(saleId: string, customerId: string, restaurantId: string, orderNumber: string, total: number) {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { phone: true, smsReceipts: true, language: true, loyaltyBalance: true, restaurant: { select: { name: true } } } });
    if (!customer?.smsReceipts || !customer.phone) return;
    const language = smsLanguage(customer.language);
    const earned = (await prisma.loyaltyTransaction.findFirst({ where: { customerId, orderId: saleId, type: 'EARN' }, select: { points: true } }))?.points || 0;
    const body = receiptSms(language, { restaurant: customer.restaurant.name, orderNumber, total, points: earned, balance: customer.loyaltyBalance });
    await sendSms({ restaurantId, phone: customer.phone, kind: 'RECEIPT', body, language, customerId, saleId });
  } catch (err) {
    console.error('Receipt SMS failed:', err);
  }
}
