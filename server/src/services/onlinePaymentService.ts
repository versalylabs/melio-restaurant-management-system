import prisma from '../config/database';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';
import { createKitchenTicketForOrder } from './kitchenService';

/**
 * Simulated payments (fake M-Pesa receipts, fake card approvals, manual
 * "confirm payment" buttons) are ONLY available when PAYMENT_SIMULATION=true.
 * Leave it unset in any environment that takes real orders: with it on, anyone
 * holding an order's tracking link can mark that order as paid.
 */
export const isPaymentSimulationEnabled = (): boolean => process.env.PAYMENT_SIMULATION === 'true';

if (isPaymentSimulationEnabled()) {
  console.warn('[Payments] PAYMENT_SIMULATION=true — simulated payments are ENABLED. Never use this with real customers.');
}

export class PaymentError extends Error {
  constructor(public code: string, message: string, public statusCode = 400) {
    super(message);
    this.name = 'PaymentError';
  }
}

export interface SettleOnlinePaymentInput {
  onlineOrderId: string;
  /** Specific pending payment row to complete; otherwise the latest pending one is used or a new row is created. */
  paymentId?: string;
  method: string;
  amount: number;
  reference: string;
  notes: string;
  /** Human readable method for realtime events, e.g. "M-Pesa". */
  displayMethod: string;
  extraEventData?: Record<string, unknown>;
}

/**
 * Marks an online order as paid. This must only be called after the payment
 * provider has confirmed the money was received (or in simulation mode).
 */
export async function settleOnlinePayment(input: SettleOnlinePaymentInput) {
  const result = await prisma.$transaction(async (tx) => {
    const online = await tx.onlineOrder.findUnique({
      where: { id: input.onlineOrderId },
      include: { sale: true },
    });
    if (!online) throw new PaymentError('ORDER_NOT_FOUND', 'Order not found', 404);
    if (online.paymentState === 'PAID') return { alreadyPaid: true as const, online };
    if (online.sale.status === 'CANCELLED') throw new PaymentError('ORDER_CANCELLED', 'This order was cancelled');

    const outstanding = Math.max(0, online.sale.totalAmount - online.sale.amountPaid);
    if (input.amount + 0.01 < outstanding) {
      throw new PaymentError('AMOUNT_MISMATCH', `Payment of ${input.amount} is less than the outstanding ${outstanding}`);
    }

    const target = input.paymentId
      ? await tx.payment.findFirst({ where: { id: input.paymentId, saleId: online.saleId } })
      : await tx.payment.findFirst({ where: { saleId: online.saleId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });

    if (target) {
      await tx.payment.update({
        where: { id: target.id },
        data: { status: 'COMPLETED', method: input.method, amount: input.amount, reference: input.reference, notes: input.notes },
      });
    } else {
      await tx.payment.create({
        data: {
          restaurantId: online.restaurantId,
          branchId: online.branchId,
          saleId: online.saleId,
          method: input.method,
          amount: input.amount,
          status: 'COMPLETED',
          reference: input.reference,
          notes: input.notes,
          createdBy: online.sale.createdBy,
        },
      });
    }

    await tx.sale.update({
      where: { id: online.saleId },
      data: { amountPaid: online.sale.totalAmount, paymentStatus: 'PAID' },
    });
    await tx.onlineOrder.update({ where: { id: online.id }, data: { paymentState: 'PAID' } });

    return { alreadyPaid: false as const, online };
  });

  if (result.alreadyPaid) return { alreadyPaid: true, amount: input.amount, reference: input.reference };

  const online = await prisma.onlineOrder.findUnique({
    where: { id: input.onlineOrderId },
    include: { sale: true, restaurant: true },
  });
  if (online) {
    // Prepaid online orders are held back from the kitchen until paid.
    // createKitchenTicketForOrder is idempotent (returns the existing ticket).
    if (online.paymentMethod !== 'CASH') {
      try {
        await createKitchenTicketForOrder(online.saleId, online.restaurantId, online.branchId);
        realtimeService.broadcast(`kitchen:${online.branchId}`, 'ticket_created', {
          orderId: online.saleId,
          orderNumber: online.sale.orderNumber,
          placedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[Payments] Kitchen ticket creation failed after payment; it is retried when staff record a payment:', err);
      }
    }
    realtimeService.broadcast(`order-tracking:${online.trackingToken}`, 'payment_confirmed', {
      trackingToken: online.trackingToken,
      status: 'PAID',
      method: input.displayMethod,
      receiptNumber: input.reference,
      amount: input.amount,
      timestamp: new Date().toISOString(),
      ...input.extraEventData,
    });
    realtimeService.broadcast(`orders:${online.branchId}`, 'order_paid', {
      saleId: online.saleId,
      orderNumber: online.sale.orderNumber,
      amount: input.amount,
      method: input.displayMethod,
      receiptNumber: input.reference,
    });
    try {
      await notifyCustomerOrderUpdate({
        trackingToken: online.trackingToken,
        orderNumber: online.sale.orderNumber,
        status: online.sale.status,
        customerPhone: online.contactPhone,
        customerEmail: online.contactEmail,
        restaurantName: online.restaurant.name,
        totalAmount: input.amount,
      });
    } catch (err) {
      console.error('[Payments] Customer notification failed after successful payment:', err);
    }
  }

  return { alreadyPaid: false, amount: input.amount, reference: input.reference };
}
