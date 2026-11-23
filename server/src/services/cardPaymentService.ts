import crypto from 'crypto';
import prisma from '../config/database';
import { isPaymentSimulationEnabled, PaymentError, settleOnlinePayment } from './onlinePaymentService';

export interface CardPaymentInput {
  trackingToken: string;
  /** Last four digits only; full card numbers never reach this server. */
  cardLast4?: string;
  cardName?: string;
}

/**
 * There is no real card processor integrated yet. Raw card numbers must never
 * be sent to this server in production (PCI-DSS) — integrate a hosted checkout
 * (e.g. Stripe Checkout, Pesapal, Flutterwave) whose webhook calls
 * settleOnlinePayment(). Until then card payments only work in simulation mode.
 */
export async function processCardPayment({ trackingToken, cardLast4, cardName }: CardPaymentInput) {
  if (!isPaymentSimulationEnabled()) {
    throw new PaymentError('CARD_PAYMENTS_UNAVAILABLE', 'Card payments are not available yet. Please pay with M-Pesa or on pickup.', 503);
  }

  const online = await prisma.onlineOrder.findUnique({ where: { trackingToken }, include: { sale: true } });
  if (!online) throw new PaymentError('ORDER_NOT_FOUND', 'Order not found', 404);
  if (online.paymentState === 'PAID') throw new PaymentError('ORDER_ALREADY_PAID', 'This order has already been paid');

  const payableAmount = Math.max(0, online.sale.totalAmount - online.sale.amountPaid);
  if (payableAmount <= 0) throw new PaymentError('ORDER_ALREADY_PAID', 'This order has already been paid');

  const last4 = (cardLast4 || '').replace(/\D/g, '').slice(-4) || '0000';
  const reference = `SIM_CARD_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

  await settleOnlinePayment({
    onlineOrderId: online.id,
    method: 'CARD',
    amount: payableAmount,
    reference,
    notes: `SIMULATED card payment (${cardName || 'Cardholder'}) ending in ${last4}`,
    displayMethod: 'Credit / Debit Card',
    extraEventData: { cardLast4: last4 },
  });

  return { success: true, paymentState: 'PAID', reference, cardLast4: last4, amount: payableAmount };
}
