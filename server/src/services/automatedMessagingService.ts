import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import { notificationHistory, NotificationLog } from './customerNotificationService';

export interface AutomatedMessageTemplate {
  action: string;
  name: string;
  description: string;
  channel: 'EMAIL' | 'SMS' | 'BOTH';
  enabled: boolean;
  subject: string;
  template: string;
  placeholders: string[];
}

export const DEFAULT_TEMPLATES: AutomatedMessageTemplate[] = [
  {
    action: 'ORDER_SUBMITTED',
    name: 'Order Placed / Received',
    description: 'Triggered instantly when a customer places an online order',
    channel: 'BOTH',
    enabled: true,
    subject: 'Order Confirmed — #{orderNumber} at {restaurantName}',
    template: `Hello {customerName},

Thank you for choosing {restaurantName}! We have received your order #{orderNumber} totaling {totalAmount}.

Our kitchen has received your ticket and is preparing fresh ingredients.
Track your live order status here: {trackingLink}
Delivery address: {deliveryAddress}

Warm regards,
The {restaurantName} Team`,
    placeholders: ['{restaurantName}', '{customerName}', '{orderNumber}', '{totalAmount}', '{trackingLink}', '{deliveryAddress}'],
  },
  {
    action: 'ORDER_PREPARING',
    name: 'Kitchen Started Cooking',
    description: 'Triggered when the kitchen marks the order as preparing',
    channel: 'BOTH',
    enabled: true,
    subject: 'Kitchen Update — Preparing Order #{orderNumber}',
    template: `Great news {customerName}!

Our chefs at {restaurantName} have started handcrafting your gourmet order #{orderNumber}.
Track live progress: {trackingLink}

We will notify you the moment your meal is ready!`,
    placeholders: ['{restaurantName}', '{customerName}', '{orderNumber}', '{trackingLink}'],
  },
  {
    action: 'ORDER_READY',
    name: 'Order Ready for Pickup / Dispatch',
    description: 'Triggered when the meal is freshly cooked and plated',
    channel: 'BOTH',
    enabled: true,
    subject: 'Your Order #{orderNumber} is Ready!',
    template: `Hi {customerName},

Your order #{orderNumber} from {restaurantName} is freshly prepared and ready for dispatch/pickup!
Track status: {trackingLink}`,
    placeholders: ['{restaurantName}', '{customerName}', '{orderNumber}', '{trackingLink}'],
  },
  {
    action: 'ORDER_OUT_FOR_DELIVERY',
    name: 'Courier Out for Delivery',
    description: 'Triggered when the courier picks up the order and begins transit',
    channel: 'BOTH',
    enabled: true,
    subject: 'Out for Delivery — Order #{orderNumber} is on the way!',
    template: `Hi {customerName},

Your order #{orderNumber} is on its way with our delivery courier to:
{deliveryAddress}

Track your delivery live: {trackingLink}
Enjoy your meal!`,
    placeholders: ['{restaurantName}', '{customerName}', '{orderNumber}', '{deliveryAddress}', '{trackingLink}'],
  },
  {
    action: 'ORDER_COMPLETED',
    name: 'Order Delivered / Completed',
    description: 'Triggered when the delivery is delivered or customer receives the order',
    channel: 'BOTH',
    enabled: true,
    subject: 'Order Delivered — Thank You from {restaurantName}!',
    template: `Hi {customerName},

Your order #{orderNumber} has been delivered successfully. Thank you for dining with {restaurantName}!

We hope you thoroughly enjoyed your meal. We look forward to serving you again soon!`,
    placeholders: ['{restaurantName}', '{customerName}', '{orderNumber}', '{restaurantName}'],
  },
  {
    action: 'RESERVATION_CONFIRMED',
    name: 'Table Reservation Confirmed',
    description: 'Triggered when a table reservation is confirmed by staff',
    channel: 'BOTH',
    enabled: true,
    subject: 'Table Reservation Confirmed — {restaurantName}',
    template: `Hello {customerName},

Your table reservation ({reference}) for {guestCount} guests at {restaurantName} ({branchName}) on {reservationDate} at {reservationTime} has been confirmed.

We look forward to hosting you!`,
    placeholders: ['{customerName}', '{reference}', '{guestCount}', '{restaurantName}', '{branchName}', '{reservationDate}', '{reservationTime}'],
  },
];

const DATA_DIR = path.resolve(process.cwd(), 'data', 'automated_messages');

function getFilePath(restaurantId: string): string {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return path.join(DATA_DIR, `${restaurantId}.json`);
}

export function getTemplatesForRestaurant(restaurantId: string): AutomatedMessageTemplate[] {
  try {
    const filePath = getFilePath(restaurantId);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const saved: AutomatedMessageTemplate[] = JSON.parse(content);
      // Merge with any new default actions
      return DEFAULT_TEMPLATES.map((def) => {
        const found = saved.find((s) => s.action === def.action);
        return found ? { ...def, ...found } : def;
      });
    }
  } catch (err) {
    console.warn('Could not read automated message templates, using defaults:', err);
  }
  return DEFAULT_TEMPLATES;
}

export function saveTemplatesForRestaurant(
  restaurantId: string,
  templates: AutomatedMessageTemplate[]
): void {
  try {
    const filePath = getFilePath(restaurantId);
    fs.writeFileSync(filePath, JSON.stringify(templates, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving automated message templates:', err);
  }
}

export function updateSingleTemplate(
  restaurantId: string,
  action: string,
  data: Partial<AutomatedMessageTemplate>
): AutomatedMessageTemplate[] {
  const current = getTemplatesForRestaurant(restaurantId);
  const updated = current.map((t) => (t.action === action ? { ...t, ...data } : t));
  saveTemplatesForRestaurant(restaurantId, updated);
  return updated;
}

export function resolveMessage(
  restaurantId: string,
  action: string,
  context: Record<string, string | number | undefined | null>
): { enabled: boolean; channel: 'EMAIL' | 'SMS' | 'BOTH'; subject: string; body: string } | null {
  const templates = getTemplatesForRestaurant(restaurantId);
  const match = templates.find((t) => t.action === action);
  if (!match || !match.enabled) return null;

  let body = match.template;
  let subject = match.subject;

  for (const [key, val] of Object.entries(context)) {
    const placeholder = `{${key}}`;
    const strVal = val != null ? String(val) : '';
    body = body.split(placeholder).join(strVal);
    subject = subject.split(placeholder).join(strVal);
  }

  return {
    enabled: match.enabled,
    channel: match.channel,
    subject,
    body,
  };
}
