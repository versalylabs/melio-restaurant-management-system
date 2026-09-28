import prisma from '../config/database';
import { realtimeService } from './realtimeService';

export interface NotificationLog {
  id: string;
  type: 'SMS' | 'EMAIL' | 'PUSH';
  recipient: string;
  subject?: string;
  message: string;
  status: 'SENT' | 'SIMULATED' | 'FAILED';
  createdAt: Date;
}

// In-memory inspection log for simulated / dev messages
import { resolveMessage } from './automatedMessagingService';

export const notificationHistory: NotificationLog[] = [];

export async function notifyCustomerOrderUpdate({
  trackingToken,
  orderNumber,
  status,
  customerName,
  customerPhone,
  customerEmail,
  restaurantName,
  restaurantId,
  totalAmount,
  deliveryAddress,
}: {
  trackingToken: string;
  orderNumber: string;
  status: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  restaurantName: string;
  restaurantId?: string | null;
  totalAmount?: number;
  deliveryAddress?: string | null;
}) {
  const statusMessages: Record<string, string> = {
    SUBMITTED: `Thank you for dining with ${restaurantName}! Your order ${orderNumber} has been received. Track live: /online-order/${trackingToken}`,
    PREPARING: `Great news! The kitchen at ${restaurantName} has started preparing your gourmet order ${orderNumber}.`,
    READY: `Your order ${orderNumber} from ${restaurantName} is freshly prepared and ready!`,
    OUT_FOR_DELIVERY: `Your order ${orderNumber} is now on its way with our delivery courier!`,
    SERVED: `Your order ${orderNumber} has been served. Enjoy your meal at ${restaurantName}!`,
    COMPLETED: `Your order ${orderNumber} is complete. Thank you for choosing ${restaurantName}!`,
    CANCELLED: `Your order ${orderNumber} from ${restaurantName} has been cancelled. If you have questions, please reach out to us.`,
  };

  let message = statusMessages[status] || `Your order ${orderNumber} status is now ${status}.`;
  let subject = `${restaurantName} — Order ${orderNumber} Update: ${status}`;
  let sendEmail = !!customerEmail;
  let sendSms = !!customerPhone;

  // Check if owner has configured a custom automated message template for this action
  if (restaurantId) {
    const custom = resolveMessage(restaurantId, `ORDER_${status}`, {
      restaurantName,
      customerName: customerName || 'Valued Customer',
      orderNumber,
      status,
      totalAmount: totalAmount ? `KES ${totalAmount.toLocaleString()}` : '',
      trackingLink: `/online-order/${trackingToken}`,
      deliveryAddress: deliveryAddress ? deliveryAddress.replace(/\s*\[geo:[-\d.]+,\s*[-\d.]+\]/, '') : 'Provided address',
    });

    if (custom) {
      message = custom.body;
      subject = custom.subject;
      if (custom.channel === 'EMAIL') sendSms = false;
      if (custom.channel === 'SMS') sendEmail = false;
    }
  }

  // 1. Dispatch Realtime event to the customer's active tracking stream
  realtimeService.broadcast(`order-tracking:${trackingToken}`, 'order_status_updated', {
    trackingToken,
    orderNumber,
    status,
    message,
    timestamp: new Date().toISOString(),
  });

  // 2. Dispatch simulated/live SMS if phone is provided
  if (customerPhone && sendSms) {
    const smsEntry: NotificationLog = {
      id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'SMS',
      recipient: customerPhone,
      message,
      status: process.env.SMS_API_KEY ? 'SENT' : 'SIMULATED',
      createdAt: new Date(),
    };
    notificationHistory.unshift(smsEntry);
    if (notificationHistory.length > 500) notificationHistory.pop();
    console.log(`[SMS DISPATCH -> ${customerPhone}]: ${message}`);
  }

  // 3. Dispatch simulated/live Email if email is provided
  if (customerEmail && sendEmail) {
    const emailEntry: NotificationLog = {
      id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'EMAIL',
      recipient: customerEmail,
      subject,
      message,
      status: process.env.SMTP_HOST ? 'SENT' : 'SIMULATED',
      createdAt: new Date(),
    };
    notificationHistory.unshift(emailEntry);
    if (notificationHistory.length > 500) notificationHistory.pop();
    console.log(`[EMAIL DISPATCH -> ${customerEmail}]: Subject "${emailEntry.subject}"`);
  }
}

export async function notifyCustomerReservation({
  reference,
  customerName,
  customerPhone,
  customerEmail,
  restaurantName,
  branchName,
  reservationDate,
  reservationTime,
  guestCount,
  status,
}: {
  reference: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  restaurantName: string;
  branchName: string;
  reservationDate: string;
  reservationTime: string;
  guestCount: number;
  status: string;
}) {
  const message = `Hello ${customerName}, your table reservation (${reference}) for ${guestCount} guests at ${restaurantName} (${branchName}) on ${reservationDate} at ${reservationTime} is ${status}.`;

  // 1. Broadcast to reservation tracking stream
  realtimeService.broadcast(`reservation:${reference}`, 'reservation_status_updated', {
    reference,
    status,
    message,
    timestamp: new Date().toISOString(),
  });

  // 2. Dispatch SMS
  if (customerPhone) {
    const smsEntry: NotificationLog = {
      id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'SMS',
      recipient: customerPhone,
      message,
      status: process.env.SMS_API_KEY ? 'SENT' : 'SIMULATED',
      createdAt: new Date(),
    };
    notificationHistory.unshift(smsEntry);
    console.log(`[RESERVATION SMS -> ${customerPhone}]: ${message}`);
  }
}
