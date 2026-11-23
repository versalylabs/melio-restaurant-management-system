import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendError, sendResponse } from '../utils/response';
import { createAuditLog } from './auditLogService';
import { blockingPaymentsForCancel, lockSale } from './saleLedgerService';
import { validatePromotion } from './promotionService';
import { calculateOrderTotals, taxFields } from './orderCalculationService';
import { realtimeService } from './realtimeService';
import { NOT_FIRED_STATUSES } from './orderCancellationService';
import { sendApprovalError, verifyApproval } from './approvalService';

/** Statuses in which an item the kitchen has can be voided (before any money is taken). */
const VOIDABLE_STATUSES = ['SUBMITTED', 'PREPARING', 'READY', 'SERVED', 'OUT_FOR_DELIVERY'];

class VoidError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * POST /orders/:id/items/:itemId/void  { quantity, reason, approval }
 *
 * Removes some or all of one line from an order the kitchen already has,
 * with a manager's PIN. The bill is recalculated, the kitchen ticket line is
 * reduced or removed so the cooks see it, and the void is logged against the
 * person who asked and the manager who approved, for the loss report.
 */
export async function voidOrderItem(req: AuthRequest, res: Response) {
  const { id, itemId } = req.params;
  const restaurantId = req.user!.restaurantId;
  const quantity = Number(req.body?.quantity ?? 1);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
  if (!Number.isInteger(quantity) || quantity < 1) return sendError(res, 'Choose how many to remove');
  if (!reason) return sendError(res, 'Give a reason for removing the item');

  const scope = { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) };
  const sale = await prisma.sale.findFirst({ where: scope, select: { status: true, branchId: true } });
  if (!sale) return sendError(res, 'Order not found', undefined, 404);
  if (NOT_FIRED_STATUSES.includes(sale.status)) {
    return sendError(res, "The kitchen doesn't have this order yet. Edit the order to remove the item.");
  }
  if (!VOIDABLE_STATUSES.includes(sale.status)) return sendError(res, `Items can't be removed from a ${sale.status.toLowerCase()} order`);

  let approver;
  try {
    approver = await verifyApproval(req, 'remove an item the kitchen already has', { branchId: sale.branchId });
  } catch (err) {
    if (sendApprovalError(res, err)) return;
    throw err;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockSale(tx, id);
      const order = await tx.sale.findFirst({
        where: scope,
        include: { items: { include: { modifiers: true } }, promotion: true },
      });
      if (!order) throw new VoidError('Order not found', 404);
      if (!VOIDABLE_STATUSES.includes(order.status)) throw new VoidError(`Items can't be removed from a ${order.status.toLowerCase()} order`);
      const { paidAmount, mpesaInFlight } = await blockingPaymentsForCancel(tx, id);
      if (paidAmount > 0.005) throw new VoidError('This order has a payment. Refund it before removing items.', 409);
      // The customer may be paying the old total on their phone right now.
      if (mpesaInFlight) throw new VoidError('An M-Pesa payment for this order is in progress. Wait for it to finish, then refund or try again.', 409);

      const line = order.items.find((i) => i.id === itemId);
      if (!line) throw new VoidError('That item is not on this order', 404);
      if (quantity > line.quantity) throw new VoidError(`Only ${line.quantity} of ${line.itemNameSnapshot} on this order`);
      const remainingLines = order.items.filter((i) => i.id !== itemId || i.quantity > quantity);
      if (!remainingLines.length) throw new VoidError('This is the last item on the order. Cancel the order instead.');

      // Same rule as the bill: negative modifier adjustments count as 0.
      const lineUnit = (i: { unitPrice: number; modifiers: { priceAdjustment: number }[] }) =>
        i.unitPrice + i.modifiers.reduce((sum, m) => sum + Math.max(0, m.priceAdjustment), 0);
      const unit = lineUnit(line);
      const value = round2(unit * quantity);
      const left = line.quantity - quantity;

      if (left === 0) {
        // Removes the kitchen ticket line with it (cascade), so the cooks stop.
        await tx.saleItem.delete({ where: { id: line.id } });
      } else {
        await tx.saleItem.update({ where: { id: line.id }, data: { quantity: left, subtotal: round2(unit * left) } });
        await tx.kitchenTicketItem.updateMany({ where: { saleItemId: line.id }, data: { quantity: left } });
      }

      // If everything still on the ticket is already done, the ticket is ready.
      const tickets = await tx.kitchenTicket.findMany({
        where: { orderId: id, status: { in: ['NEW', 'PREPARING'] } },
        include: { items: { select: { status: true } } },
      });
      for (const t of tickets) {
        if (t.items.length && t.items.every((i) => ['READY', 'SERVED', 'COMPLETED', 'CANCELLED'].includes(i.status))) {
          await tx.kitchenTicket.update({ where: { id: t.id }, data: { status: 'READY', readyAt: new Date() } });
        }
      }

      const items = remainingLines.map((i) => ({
        menuItemId: i.menuItemId,
        unitPrice: i.unitPrice,
        quantity: i.id === itemId ? left : i.quantity,
        modifiers: i.modifiers.map((m) => ({ modifierOptionId: m.modifierOptionId, priceAdjustment: m.priceAdjustment })),
      }));
      const oldBase = order.items.reduce((sum, i) => sum + lineUnit(i) * i.quantity, 0);
      const newBase = oldBase - unit * quantity;
      // A promotion with a minimum spend (or one that has since ended) may no longer apply.
      let p = order.promotion;
      if (p) {
        try {
          await validatePromotion(p.id, restaurantId, order.branchId, order.customerId ?? undefined, newBase);
        } catch {
          p = null;
        }
      }
      const totals = await calculateOrderTotals({
        items,
        restaurantId,
        pricesIncludeTax: order.taxInclusive,
        branchId: order.branchId,
        // A manual discount shrinks with the bill (keeps a % discount a %; never grows a fixed one).
        discountAmount: p ? 0 : oldBase > 0 ? round2(order.discountAmount * (newBase / oldBase)) : 0,
        discountType: 'FIXED',
        promotion: p ? { discountType: p.discountType as 'FIXED' | 'PERCENTAGE', value: p.value, scope: p.scope as 'ORDER' | 'PRODUCT', menuItemId: p.menuItemId, maxDiscountAmount: p.maxDiscountAmount } : undefined,
      });

      const updated = await tx.sale.update({
        where: { id },
        data: {
          ...(order.promotion && !p ? { promotionId: null, discountReason: null } : {}),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          ...taxFields(totals),
          serviceChargeAmount: totals.serviceChargeAmount,
          totalAmount: totals.totalAmount,
        },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          table: { select: { id: true, tableNumber: true, name: true } },
          items: { include: { modifiers: true } },
        },
      });

      await tx.voidRecord.create({
        data: {
          restaurantId,
          branchId: order.branchId,
          saleId: id,
          kind: 'ITEM',
          saleItemId: line.id,
          itemName: line.itemNameSnapshot,
          quantity,
          value,
          reason,
          firedToKitchen: true,
          stockDeducted: !!order.inventoryDeductedAt,
          requestedBy: req.user!.id,
          approvedBy: approver.id,
        },
      });
      return { updated, itemName: line.itemNameSnapshot, value };
    });

    const sale = result.updated;
    realtimeService.broadcast(`orders:${sale.branchId}`, 'order_updated', { orderId: sale.id, orderNumber: sale.orderNumber });
    realtimeService.broadcast(`kitchen:${sale.branchId}`, 'ticket_item_updated', { orderId: sale.id });
    await createAuditLog(
      restaurantId,
      req.user!.id,
      'VOID',
      'Order',
      id,
      `Removed ${quantity} × ${result.itemName} (KES ${result.value.toLocaleString()}) from order ${sale.orderNumber}, approved by ${approver.name}. Reason: ${reason}`
    );
    return sendResponse(res, true, 'Item removed', sale);
  } catch (err: any) {
    if (err instanceof VoidError) return sendError(res, err.message, undefined, err.statusCode);
    throw err;
  }
}
