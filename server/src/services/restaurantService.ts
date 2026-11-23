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

  return sendResponse(res, true, 'Restaurant retrieved', restaurant);
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
  } = req.body;

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
    },
  });

  return sendResponse(res, true, 'Restaurant updated successfully', restaurant);
};
