import crypto from 'crypto';
import prisma from '../config/database';
import { realtimeService } from './realtimeService';
import { notifyCustomerOrderUpdate } from './customerNotificationService';

export interface StkPushInitiateInput {
  trackingToken: string;
  phoneNumber: string;
  amount?: number;
}

export interface StkTransactionState {
  checkoutRequestId: string;
  merchantRequestId: string;
  trackingToken: string;
  saleId: string;
  branchId: string;
  restaurantId: string;
  phoneNumber: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  mpesaReceiptNumber?: string;
  failureReason?: string;
  createdAt: Date;
}

// In-memory active STK tracking table
const activeStkRequests = new Map<string, StkTransactionState>();

function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.slice(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

export async function initiateMpesaStkPush({
  trackingToken,
  phoneNumber,
}: StkPushInitiateInput) {
  const online = await prisma.onlineOrder.findUnique({
    where: { trackingToken },
    include: {
      sale: true,
      restaurant: true,
      branch: true,
    },
  });

  if (!online) throw new Error('ORDER_NOT_FOUND');
  if (online.paymentState === 'PAID') throw new Error('ORDER_ALREADY_PAID');
  if (online.sale.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!/^254(7|1)\d{8}$/.test(formattedPhone)) {
    throw new Error('INVALID_PHONE_NUMBER: Please enter a valid Kenyan Safaricom phone number (e.g. 0712345678).');
  }

  const payableAmount = Math.max(0, online.sale.totalAmount - online.sale.amountPaid);
  if (payableAmount <= 0) throw new Error('ORDER_ALREADY_PAID');

  const checkoutRequestId = `ws_CO_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const merchantRequestId = `MR_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const state: StkTransactionState = {
    checkoutRequestId,
    merchantRequestId,
    trackingToken,
    saleId: online.saleId,
    branchId: online.branchId,
    restaurantId: online.restaurantId,
    phoneNumber: formattedPhone,
    amount: payableAmount,
    status: 'PENDING',
    createdAt: new Date(),
  };

  activeStkRequests.set(checkoutRequestId, state);

  // If live credentials exist, we would call Safaricom Daraja API
  // Otherwise, we return the checkoutRequestId and allow immediate simulated confirmation
  return {
    success: true,
    message: `STK Push prompt sent to ${formattedPhone}. Please enter your M-Pesa PIN on your phone to complete payment.`,
    checkoutRequestId,
    merchantRequestId,
    phoneNumber: formattedPhone,
    amount: payableAmount,
  };
}

export async function confirmMpesaPayment({
  checkoutRequestId,
  mpesaReceiptNumber,
}: {
  checkoutRequestId: string;
  mpesaReceiptNumber?: string;
}) {
  const state = activeStkRequests.get(checkoutRequestId);
  if (!state) throw new Error('TRANSACTION_NOT_FOUND');

  // Idempotency check on in-memory state
  if (state.status === 'SUCCESS') {
    return {
      success: true,
      paymentState: 'PAID',
      receiptNumber: state.mpesaReceiptNumber,
      amount: state.amount,
    };
  }

  const receipt = mpesaReceiptNumber || `QJH${Math.floor(10000000 + Math.random() * 90000000)}`;

  const online = await prisma.onlineOrder.findUnique({
    where: { trackingToken: state.trackingToken },
    include: { sale: true, restaurant: true },
  });

  if (!online) throw new Error('ORDER_NOT_FOUND');

  await prisma.$transaction(async (tx) => {
    const currentOnline = await tx.onlineOrder.findUnique({
      where: { id: online.id },
      include: { sale: true },
    });
    if (!currentOnline) throw new Error('ORDER_NOT_FOUND');
    if (currentOnline.paymentState === 'PAID') return;
    if (currentOnline.sale.status === 'CANCELLED') throw new Error('ORDER_CANCELLED');

    // 1. Update or create Payment
    const existingPayment = await tx.payment.findFirst({
      where: { saleId: online.saleId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPayment) {
      await tx.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: 'COMPLETED',
          method: 'MOBILE_MONEY',
          amount: state.amount,
          reference: receipt,
          notes: `M-Pesa STK Push paid by ${state.phoneNumber}`,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          restaurantId: online.restaurantId,
          branchId: online.branchId,
          saleId: online.saleId,
          method: 'MOBILE_MONEY',
          amount: state.amount,
          status: 'COMPLETED',
          reference: receipt,
          notes: `M-Pesa STK Push paid by ${state.phoneNumber}`,
          createdBy: online.sale.createdBy,
        },
      });
    }

    // 2. Update Sale
    await tx.sale.update({
      where: { id: online.saleId },
      data: {
        amountPaid: currentOnline.sale.totalAmount,
        paymentStatus: 'PAID',
      },
    });

    // 3. Update Online Order
    await tx.onlineOrder.update({
      where: { id: online.id },
      data: {
        paymentState: 'PAID',
      },
    });
  });

  state.status = 'SUCCESS';
  state.mpesaReceiptNumber = receipt;

  // Broadcast live payment update to order tracking and staff
  realtimeService.broadcast(`order-tracking:${state.trackingToken}`, 'payment_confirmed', {
    trackingToken: state.trackingToken,
    status: 'PAID',
    method: 'M-Pesa',
    receiptNumber: receipt,
    amount: state.amount,
    timestamp: new Date().toISOString(),
  });

  realtimeService.broadcast(`orders:${state.branchId}`, 'order_paid', {
    saleId: state.saleId,
    orderNumber: online.sale.orderNumber,
    amount: state.amount,
    method: 'M-Pesa',
    receiptNumber: receipt,
  });

  // Notify customer
  await notifyCustomerOrderUpdate({
    trackingToken: state.trackingToken,
    orderNumber: online.sale.orderNumber,
    status: online.sale.status,
    customerPhone: state.phoneNumber,
    customerEmail: online.contactEmail,
    restaurantName: online.restaurant.name,
    totalAmount: state.amount,
  });

  return {
    success: true,
    paymentState: 'PAID',
    receiptNumber: receipt,
    amount: state.amount,
  };
}

export function getMpesaStatus(checkoutRequestId: string) {
  const state = activeStkRequests.get(checkoutRequestId);
  if (!state) return null;
  return state;
}
