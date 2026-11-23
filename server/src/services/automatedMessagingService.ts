import prisma from '../config/database';

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

const CHANNELS = ['EMAIL', 'SMS', 'BOTH'] as const;
const MAX_SUBJECT = 200;
const MAX_TEMPLATE = 2000;

export class TemplateError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'AppError';
  }
}

/** Built-in defaults with the restaurant's saved edits applied on top. */
export async function getTemplatesForRestaurant(restaurantId: string): Promise<AutomatedMessageTemplate[]> {
  const saved = await prisma.messageTemplate.findMany({ where: { restaurantId } });
  return DEFAULT_TEMPLATES.map((def) => {
    const found = saved.find((row) => row.action === def.action);
    if (!found) return def;
    return {
      ...def,
      enabled: found.enabled,
      channel: (CHANNELS as readonly string[]).includes(found.channel) ? (found.channel as AutomatedMessageTemplate['channel']) : def.channel,
      subject: found.subject,
      template: found.template,
    };
  });
}

/** Saves one template. Throws (so the UI shows an error) instead of failing silently. */
export async function updateSingleTemplate(
  restaurantId: string,
  action: string,
  data: Partial<Pick<AutomatedMessageTemplate, 'enabled' | 'channel' | 'subject' | 'template'>>,
  userId?: string
): Promise<AutomatedMessageTemplate> {
  const def = DEFAULT_TEMPLATES.find((t) => t.action === action);
  if (!def) throw new TemplateError('Unknown message type', 404);
  if (data.channel !== undefined && !(CHANNELS as readonly string[]).includes(data.channel)) throw new TemplateError('Channel must be EMAIL, SMS or BOTH');
  if (data.enabled !== undefined && typeof data.enabled !== 'boolean') throw new TemplateError('Enabled must be true or false');
  if (data.subject !== undefined && (typeof data.subject !== 'string' || !data.subject.trim() || data.subject.length > MAX_SUBJECT)) {
    throw new TemplateError(`Subject is required and must be at most ${MAX_SUBJECT} characters`);
  }
  if (data.template !== undefined && (typeof data.template !== 'string' || !data.template.trim() || data.template.length > MAX_TEMPLATE)) {
    throw new TemplateError(`Message is required and must be at most ${MAX_TEMPLATE} characters`);
  }

  const current = (await getTemplatesForRestaurant(restaurantId)).find((t) => t.action === action)!;
  const next = { ...current, ...data };
  await prisma.messageTemplate.upsert({
    where: { restaurantId_action: { restaurantId, action } },
    create: { restaurantId, action, enabled: next.enabled, channel: next.channel, subject: next.subject, template: next.template, updatedBy: userId || null },
    update: { enabled: next.enabled, channel: next.channel, subject: next.subject, template: next.template, updatedBy: userId || null },
  });
  return next;
}

export function fillTemplate(text: string, context: Record<string, string | number | undefined | null>): string {
  let out = text;
  for (const [key, val] of Object.entries(context)) {
    out = out.split(`{${key}}`).join(val != null ? String(val) : '');
  }
  return out;
}

/**
 * The message to send for an action. Returns null when the action has no
 * template (the caller uses its default text), and `enabled: false` when the
 * owner switched it off (the caller must not send anything).
 */
export async function resolveMessage(
  restaurantId: string,
  action: string,
  context: Record<string, string | number | undefined | null>
): Promise<{ enabled: boolean; channel: 'EMAIL' | 'SMS' | 'BOTH'; subject: string; body: string } | null> {
  let templates: AutomatedMessageTemplate[];
  try {
    templates = await getTemplatesForRestaurant(restaurantId);
  } catch (err) {
    console.warn('Could not load message templates, using defaults:', err);
    templates = DEFAULT_TEMPLATES;
  }
  const match = templates.find((t) => t.action === action);
  if (!match) return null;
  return {
    enabled: match.enabled,
    channel: match.channel,
    subject: fillTemplate(match.subject, context),
    body: fillTemplate(match.template, context),
  };
}
