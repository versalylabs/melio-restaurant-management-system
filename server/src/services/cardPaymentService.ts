import prisma from '../config/database';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';

export interface CardPaymentInput {
  trackingToken: string;
  cardNumber?: string;
  cardExp?: string;
  cardCvc?: string;
  cardName?: string;
  amount?: number;
}

export async function processCardPayment({
  trackingToken,
  cardNumber,
  cardName,
}: CardPaymentInput) {
  const online = await prisma.onlineOrder.findUnique({
    where: { trackingToken },
    include: {
      sale: true,
      restaurant: true,
    },
  });

  if (!online) throw new Error('ORDER_NOT_FOUND');
  if (online.paymentState === 'PAID') throw new Error('ORDER_ALREADY_PAID');
  if (online.sale.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

  const payableAmount = Math.max(0, online.sale.totalAmount - online.sale.amountPaid);
  if (payableAmount <= 0) throw new Error('ORDER_ALREADY_PAID');

  const last4 = cardNumber ? cardNumber.replace(/\D/g, '').slice(-4) || '4242' : '4242';
  const cardReference = `CARD_AUTH_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  await prisma.$transaction(async (tx) => {
    const currentOnline = await tx.onlineOrder.findUnique({
      where: { id: online.id },
      include: { sale: true },
    });
    if (!currentOnline) throw new Error('ORDER_NOT_FOUND');
    if (currentOnline.paymentState === 'PAID') throw new Error('ORDER_ALREADY_PAID');
    if (currentOnline.sale.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

    // 1. Create or update payment
    const existing = await tx.payment.findFirst({
      where: { saleId: online.saleId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: 'COMPLETED',
          method: 'CARD',
          amount: payableAmount,
          reference: cardReference,
          notes: `Card payment (${cardName || 'Cardholder'}) ending in •••• ${last4}`,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          restaurantId: online.restaurantId,
          branchId: online.branchId,
          saleId: online.saleId,
          method: 'CARD',
          amount: payableAmount,
          status: 'COMPLETED',
          reference: cardReference,
          notes: `Card payment (${cardName || 'Cardholder'}) ending in •••• ${last4}`,
          createdBy: online.sale.createdBy,
        },
      });
    }

    // 2. Update sale
    await tx.sale.update({
      where: { id: online.saleId },
      data: {
        amountPaid: currentOnline.sale.totalAmount,
        paymentStatus: 'PAID',
      },
    });

    // 3. Update online order
    await tx.onlineOrder.update({
      where: { id: online.id },
      data: {
        paymentState: 'PAID',
      },
    });
  });

  // Broadcast realtime event
  realtimeService.broadcast(`order-tracking:${trackingToken}`, 'payment_confirmed', {
    trackingToken,
    status: 'PAID',
    method: 'Credit / Debit Card',
    receiptNumber: cardReference,
    amount: payableAmount,
    cardLast4: last4,
    timestamp: new Date().toISOString(),
  });

  realtimeService.broadcast(`orders:${online.branchId}`, 'order_paid', {
    saleId: online.saleId,
    orderNumber: online.sale.orderNumber,
    amount: payableAmount,
    method: 'CARD',
    receiptNumber: cardReference,
  });

  // Notify customer
  await notifyCustomerOrderUpdate({
    trackingToken,
    orderNumber: online.sale.orderNumber,
    status: online.sale.status,
    customerPhone: online.contactPhone,
    customerEmail: online.contactEmail,
    restaurantName: online.restaurant.name,
    totalAmount: payableAmount,
  });

  return {
    success: true,
    paymentState: 'PAID',
    reference: cardReference,
    cardLast4: last4,
    amount: payableAmount,
  };
}
