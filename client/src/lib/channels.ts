/** Where an order came from. Matches the server's channel list. */
export const CHANNEL_LABELS: Record<string, string> = {
  POS: 'In the restaurant',
  PHONE: 'Phone',
  WHATSAPP: 'WhatsApp',
  WEBSITE: 'Website',
  GLOVO: 'Glovo',
  UBER_EATS: 'Uber Eats',
  BOLT: 'Bolt Food',
};

/** Channels staff can pick; Website is set by online ordering only. */
export const STAFF_CHANNELS = ['POS', 'PHONE', 'WHATSAPP', 'GLOVO', 'UBER_EATS', 'BOLT'] as const;

/** Channels that usually take a commission, shown first in settings. */
export const COMMISSION_CHANNELS = ['GLOVO', 'UBER_EATS', 'BOLT', 'WEBSITE', 'WHATSAPP', 'PHONE', 'POS'] as const;

export const channelLabel = (channel?: string | null) => CHANNEL_LABELS[channel || 'POS'] || channel || 'In the restaurant';
