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
  } = req.body;

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
    },
  });

  return sendResponse(res, true, 'Restaurant updated successfully', restaurant);
};
