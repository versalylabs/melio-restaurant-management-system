import { CHANNEL_LABELS, CHANNELS, parseCommissions } from './channelService';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';

export const getRestaurant = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: req.user!.restaurantId },
  });

  if (!restaurant) {
    return sendError(res, 'Restaurant not found', undefined, 404);
  }

  return sendResponse(res, true, 'Restaurant retrieved', { ...restaurant, channelCommissions: parseCommissions(restaurant.channelCommissions) });
};

export const updateRestaurant = async (req: AuthRequest, res: ExpressResponse) => {
  const {
    name,
    legalName,
    description,
    phone,
    email,
    address,
    city,
    country,
    currency,
    logo,
    timezone,
    taxRate,
    serviceChargeRate,
    kraPin,
    vatRegistered,
    pricesIncludeTax,
    tourismLevyRate,
    channelCommissions,
    whatsappNumber,
  } = req.body;

  // Commission each delivery app or channel takes, 0–60%.
  let commissions: string | undefined;
  if (channelCommissions !== undefined) {
    if (!channelCommissions || typeof channelCommissions !== 'object') return sendError(res, 'Invalid channel commissions');
    const clean: Record<string, number> = {};
    for (const c of CHANNELS) {
      const raw = (channelCommissions as any)[c];
      if (raw === undefined || raw === null || raw === '') continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 60) return sendError(res, `The ${CHANNEL_LABELS[c]} commission must be between 0% and 60%`);
      if (v > 0) clean[c] = Math.round(v * 100) / 100;
    }
    commissions = JSON.stringify(clean);
  }
  let wa: string | null | undefined;
  if (whatsappNumber !== undefined) {
    let d = String(whatsappNumber || '').replace(/[^0-9]/g, '');
    if (d.startsWith('0')) d = '254' + d.slice(1);
    if (d && !/^254[17]\d{8}$/.test(d)) return sendError(res, 'Enter the WhatsApp number like 0712 345 678');
    wa = d || null;
  }

  // KRA PINs look like P051234567X: a letter, nine digits, a letter.
  let pin: string | null | undefined;
  if (kraPin !== undefined) {
    pin = String(kraPin || '').trim().toUpperCase() || null;
    if (pin && !/^[A-Z]\d{9}[A-Z]$/.test(pin)) return sendError(res, 'Enter the KRA PIN as it appears on your PIN certificate, e.g. P051234567X');
  }
  const levy = tourismLevyRate !== undefined ? Number(tourismLevyRate) : undefined;
  if (levy !== undefined && (!Number.isFinite(levy) || levy < 0 || levy > 10)) return sendError(res, 'The Tourism Levy rate must be between 0% and 10%');

  const restaurant = await prisma.restaurant.update({
    where: { id: req.user!.restaurantId },
    data: {
      name: name || undefined,
      legalName: legalName || undefined,
      description: description || undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      country: country || undefined,
      currency: currency || undefined,
      logo: logo || undefined,
      timezone: timezone || undefined,
      taxRate: taxRate !== undefined ? Math.max(0, Number(taxRate) || 0) / 100 : undefined,
      serviceChargeRate: serviceChargeRate !== undefined ? Math.max(0, Number(serviceChargeRate) || 0) / 100 : undefined,
      kraPin: pin,
      vatRegistered: vatRegistered !== undefined ? !!vatRegistered : undefined,
      pricesIncludeTax: pricesIncludeTax !== undefined ? !!pricesIncludeTax : undefined,
      tourismLevyRate: levy !== undefined ? levy / 100 : undefined,
      channelCommissions: commissions,
      whatsappNumber: wa,
    },
  });

  return sendResponse(res, true, 'Restaurant updated successfully', restaurant);
};
