import prisma from '../config/database';

/** Where an order came from. WEBSITE is set by online ordering; staff choose from the rest. */
export const CHANNELS = ['POS', 'PHONE', 'WHATSAPP', 'WEBSITE', 'GLOVO', 'UBER_EATS', 'BOLT'] as const;
export type Channel = (typeof CHANNELS)[number];
export const STAFF_CHANNELS: readonly string[] = CHANNELS.filter((c) => c !== 'WEBSITE');
export const CHANNEL_LABELS: Record<Channel, string> = {
  POS: 'In the restaurant',
  PHONE: 'Phone',
  WHATSAPP: 'WhatsApp',
  WEBSITE: 'Website',
  GLOVO: 'Glovo',
  UBER_EATS: 'Uber Eats',
  BOLT: 'Bolt Food',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The restaurant's commission percentages per channel, cleaned (0–60%). */
export function parseCommissions(raw: string | null | undefined): Partial<Record<Channel, number>> {
  const out: Partial<Record<Channel, number>> = {};
  try {
    const obj = JSON.parse(raw || '{}');
    for (const c of CHANNELS) {
      const v = Number(obj?.[c]);
      if (Number.isFinite(v) && v > 0 && v <= 60) out[c] = Math.round(v * 100) / 100;
    }
  } catch {
    /* treat as none */
  }
  return out;
}

/** Commission (as a fraction) for a channel, read at the moment the order is placed. */
export async function commissionRateFor(restaurantId: string, channel: string): Promise<number> {
  const r = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { channelCommissions: true } });
  const pct = parseCommissions(r?.channelCommissions)[channel as Channel] || 0;
  return pct / 100;
}

/** Channel fields for a new order: the rate is frozen so later setting changes don't rewrite history. */
export async function channelFields(restaurantId: string, channel: string, totalAmount: number) {
  const rate = await commissionRateFor(restaurantId, channel);
  return { channel, commissionRate: rate, commissionAmount: round2(totalAmount * rate) };
}

/** When a bill's total changes (edit, void), its commission follows at the frozen rate. */
export const commissionOn = (totalAmount: number, rate: number) => round2(totalAmount * (rate || 0));
