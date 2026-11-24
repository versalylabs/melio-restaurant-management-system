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
import { afterResponse, sendSms } from './smsService';
import { orderUpdateSms, reservationSms, smsLanguage } from './smsTemplates';

/** Full link for SMS: the first configured site address. */
const siteLink = (path: string) => {
  const base = (process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
  return /^https?:\/\//.test(base) ? `${base}${path}` : '';
};
const languageOf = async (customerId?: string | null) =>
  customerId ? smsLanguage((await prisma.customer.findUnique({ where: { id: customerId }, select: { language: true } }))?.language) : 'en';

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
  saleId,
  customerId,
}: {
  saleId?: string | null;
  customerId?: string | null;
  trackingToken: string;
  orderNumber: string;
  status: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  restaurantName: string;
  restaurantId: string;
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
  let sendSms_ = !!customerPhone;
  let usedCustom = false;

  // Check if owner has configured a custom automated message template for this action
  if (restaurantId) {
    const custom = await resolveMessage(restaurantId, `ORDER_${status}`, {
      restaurantName,
      customerName: customerName || 'Valued Customer',
      orderNumber,
      status,
      totalAmount: totalAmount ? `KES ${totalAmount.toLocaleString()}` : '',
      trackingLink: `/online-order/${trackingToken}`,
      deliveryAddress: deliveryAddress ? deliveryAddress.replace(/\s*\[geo:[-\d.]+,\s*[-\d.]+\]/, '') : 'Provided address',
    });

    if (custom && !custom.enabled) {
      // The owner turned this message off: keep the live tracking update below,
      // but send no SMS or email.
      sendEmail = false;
      sendSms_ = false;
    } else if (custom) {
      usedCustom = true;
      message = custom.body;
      subject = custom.subject;
      if (custom.channel === 'EMAIL') sendSms_ = false;
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

  // 2. SMS (really sent when Africa's Talking is set up; logged in test mode)
  if (customerPhone && sendSms_ && restaurantId) {
    const language = await languageOf(customerId);
    const body = usedCustom ? message : orderUpdateSms(language, status, { restaurant: restaurantName, orderNumber, trackingLink: siteLink(`/online-order/${trackingToken}`) });
    afterResponse(sendSms({ restaurantId, phone: customerPhone, kind: `ORDER_${status}`, body, language, customerId, saleId }));
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
  restaurantId,
  customerId,
}: {
  restaurantId?: string | null;
  customerId?: string | null;
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

  // 2. SMS
  if (customerPhone && restaurantId) {
    const language = await languageOf(customerId);
    const body = reservationSms(language, { restaurant: restaurantName, branch: branchName, reference, guests: guestCount, date: reservationDate, time: reservationTime });
    afterResponse(sendSms({ restaurantId, phone: customerPhone, kind: 'RESERVATION', body, language, customerId }));
  }
}
