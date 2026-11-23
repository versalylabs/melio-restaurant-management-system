import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import prisma from '../config/database';
import { sendError, sendResponse } from '../utils/response';

/** JWT secret for customer sessions. The server refuses to start in production without JWT_SECRET. */
const customerJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is not configured');
  return 'dev-only-customer-secret';
};

type PublicContact = { name: string; phone?: string | null; email?: string | null; address?: string | null; notes: string };

/**
 * Works out which customer record a public (website) order or reservation
 * belongs to.
 *
 * - A signed-in customer (valid customer token) always gets their own account.
 * - A guest is matched only to an existing *guest* profile (no password) with
 *   the same phone/email, and that profile is never modified. Guests are never
 *   attached to a registered account: a phone number or e-mail typed into a
 *   form proves nothing, and attaching would let strangers add orders to, or
 *   change the details of, someone else's account.
 */
export async function resolvePublicCustomer(req: Request, restaurantId: string, contact: PublicContact) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), customerJwtSecret()) as { customerId?: string; type?: string };
      if (decoded.type === 'CUSTOMER' && decoded.customerId) {
        const account = await prisma.customer.findFirst({ where: { id: decoded.customerId, restaurantId, status: 'ACTIVE' } });
        if (account) return account;
      }
    } catch {
      // Invalid/expired token: fall through and treat the request as a guest.
    }
  }

  const phone = contact.phone?.trim() || null;
  const email = contact.email?.trim().toLowerCase() || null;
  if (phone || email) {
    const guest = await prisma.customer.findFirst({
      where: { restaurantId, password: null, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
      orderBy: { createdAt: 'asc' },
    });
    if (guest) return guest;
  }

  return prisma.customer.create({
    data: { restaurantId, name: contact.name, phone, email, address: contact.address || null, notes: contact.notes, status: 'ACTIVE' },
  });
}

export interface CustomerAuthRequest extends Request {
  customer?: {
    id: string;
    restaurantId: string;
    name: string;
    email?: string | null;
    phone?: string | null;
  };
}

export const authenticateCustomer = async (req: CustomerAuthRequest, res: Response, next: () => void) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'Authentication required', undefined, 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, customerJwtSecret()) as {
      customerId: string;
      restaurantId: string;
      type: string;
    };

    if (decoded.type !== 'CUSTOMER') {
      return sendError(res, 'Invalid customer session token', undefined, 401);
    }

    const customer = await prisma.customer.findUnique({
      where: { id: decoded.customerId },
      select: { id: true, restaurantId: true, name: true, email: true, phone: true, status: true },
    });

    if (!customer || customer.status !== 'ACTIVE') {
      return sendError(res, 'Customer account inactive or not found', undefined, 401);
    }

    req.customer = customer;
    next();
  } catch {
    return sendError(res, 'Session expired. Please log in again.', undefined, 401);
  }
};

export const registerCustomer = async (req: Request, res: Response) => {
  const body = req.body || {};
  let restaurantId = String(body.restaurantId || '').trim();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  const address = String(body.address || '').trim();

  if (!name) return sendError(res, 'Customer name is required');
  if (!email && !phone) return sendError(res, 'An email or phone number is required');
  if (!password || password.length < 6) return sendError(res, 'Password must be at least 6 characters');

  if (!restaurantId) {
    const defaultRest = await prisma.restaurant.findFirst({ select: { id: true } });
    if (!defaultRest) return sendError(res, 'Restaurant configuration not found');
    restaurantId = defaultRest.id;
  }

  // Only registered accounts (with a password) block a new registration.
  const existingAccount = await prisma.customer.findFirst({
    where: {
      restaurantId,
      password: { not: null },
      OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
    },
    select: { id: true },
  });
  if (existingAccount) {
    return sendError(res, 'An account with this email/phone already exists. Please log in.', undefined, 409);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // A new account is always created. Guest profiles from earlier website
  // orders are NOT claimed: knowing someone's phone number or e-mail must not
  // reveal their order history, addresses or loyalty points. (Merging guest
  // history safely needs a one-time code sent to that phone/e-mail.)
  const customer = await prisma.customer.create({
    data: {
      restaurantId,
      name,
      email: email || null,
      phone: phone || null,
      password: hashedPassword,
      address: address || null,
      status: 'ACTIVE',
      loyaltyBalance: 0,
    },
  });

  const token = jwt.sign(
    { customerId: customer.id, restaurantId, type: 'CUSTOMER' },
    customerJwtSecret(),
    { expiresIn: '30d' }
  );

  return sendResponse(
    res,
    true,
    'Customer account registered successfully',
    {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        loyaltyBalance: customer.loyaltyBalance,
      },
      token,
    },
    201
  );
};

export const loginCustomer = async (req: Request, res: Response) => {
  const body = req.body || {};
  let restaurantId = String(body.restaurantId || '').trim();
  const identifier = String(body.identifier || body.email || body.phone || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!identifier || !password) {
    return sendError(res, 'Email/phone and password are required');
  }

  if (!restaurantId) {
    const defaultRest = await prisma.restaurant.findFirst({ select: { id: true } });
    if (defaultRest) {
      restaurantId = defaultRest.id;
    }
  }

  const customer = await prisma.customer.findFirst({
    where: {
      ...(restaurantId ? { restaurantId } : {}),
      password: { not: null },
      OR: [{ email: identifier }, { phone: identifier }],
    },
  });

  if (!customer || !customer.password) {
    return sendError(res, 'Invalid email/phone or password', undefined, 401);
  }

  if (customer.status !== 'ACTIVE') {
    return sendError(res, 'Customer account is inactive. Please contact support.', undefined, 403);
  }

  const match = await bcrypt.compare(password, customer.password);
  if (!match) {
    return sendError(res, 'Invalid email/phone or password', undefined, 401);
  }

  const token = jwt.sign(
    { customerId: customer.id, restaurantId, type: 'CUSTOMER' },
    customerJwtSecret(),
    { expiresIn: '30d' }
  );

  let favoriteIds: string[] = [];
  try {
    if (customer.favoriteItemIds) favoriteIds = JSON.parse(customer.favoriteItemIds);
  } catch {}

  return sendResponse(res, true, 'Logged in successfully', {
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      loyaltyBalance: customer.loyaltyBalance,
      favoriteItemIds: favoriteIds,
    },
    token,
  });
};

export const getCustomerProfile = async (req: CustomerAuthRequest, res: Response) => {
  const customerId = req.customer!.id;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      loyaltyBalance: true,
      favoriteItemIds: true,
      createdAt: true,
    },
  });

  if (!customer) return sendError(res, 'Customer not found', undefined, 404);

  let favoriteIds: string[] = [];
  try {
    if (customer.favoriteItemIds) favoriteIds = JSON.parse(customer.favoriteItemIds);
  } catch {}

  return sendResponse(res, true, 'Customer profile retrieved', {
    ...customer,
    favoriteItemIds: favoriteIds,
  });
};

export const updateCustomerProfile = async (req: CustomerAuthRequest, res: Response) => {
  const customerId = req.customer!.id;
  const { name, phone, email, address } = req.body || {};

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(address !== undefined ? { address } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      loyaltyBalance: true,
      favoriteItemIds: true,
    },
  });

  let favoriteIds: string[] = [];
  try {
    if (updated.favoriteItemIds) favoriteIds = JSON.parse(updated.favoriteItemIds);
  } catch {}

  return sendResponse(res, true, 'Profile updated successfully', {
    ...updated,
    favoriteItemIds: favoriteIds,
  });
};

export const getCustomerOrders = async (req: CustomerAuthRequest, res: Response) => {
  const customerId = req.customer!.id;
  const restaurantId = req.customer!.restaurantId;

  const orders = await prisma.sale.findMany({
    where: { customerId, restaurantId },
    orderBy: { createdAt: 'desc' },
    include: {
      items: true,
      branch: { select: { id: true, name: true, city: true, phone: true } },
      onlineOrder: true,
    },
    take: 50,
  });

  return sendResponse(res, true, 'Customer orders retrieved', {
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      orderType: o.orderType,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalAmount: o.totalAmount,
      placedAt: o.createdAt,
      branch: o.branch,
      trackingToken: o.onlineOrder?.trackingToken || null,
      fulfillmentType: o.onlineOrder?.fulfillmentType || o.orderType,
      deliveryAddress: o.onlineOrder?.deliveryAddress || null,
      items: o.items.map((i) => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.itemNameSnapshot,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.subtotal,
      })),
    })),
  });
};

export const getCustomerReservations = async (req: CustomerAuthRequest, res: Response) => {
  const customerId = req.customer!.id;
  const restaurantId = req.customer!.restaurantId;

  const reservations = await prisma.reservation.findMany({
    where: { customerId, restaurantId },
    orderBy: { startAt: 'desc' },
    include: {
      branch: { select: { id: true, name: true, city: true, address: true, phone: true } },
      table: { select: { id: true, tableNumber: true, name: true } },
    },
    take: 50,
  });

  return sendResponse(res, true, 'Customer reservations retrieved', {
    reservations: reservations.map((r) => ({
      id: r.id,
      reservationCode: `RES-${r.id.slice(-6).toUpperCase()}`,
      partySize: r.partySize,
      startAt: r.startAt,
      endAt: r.endAt,
      status: r.status,
      notes: r.notes,
      source: r.source,
      branch: r.branch,
      tableNumber: r.table?.tableNumber || null,
    })),
  });
};

export const getCustomerLoyalty = async (req: CustomerAuthRequest, res: Response) => {
  const customerId = req.customer!.id;
  const restaurantId = req.customer!.restaurantId;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { loyaltyBalance: true },
  });

  const transactions = await prisma.loyaltyTransaction.findMany({
    where: { customerId, restaurantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const balance = customer?.loyaltyBalance || 0;
  let tier = 'Bronze';
  if (balance >= 3000) tier = 'Platinum';
  else if (balance >= 1500) tier = 'Gold';
  else if (balance >= 500) tier = 'Silver';

  return sendResponse(res, true, 'Loyalty summary retrieved', {
    balance,
    tier,
    transactions,
  });
};

export const toggleFavoriteItem = async (req: CustomerAuthRequest, res: Response) => {
  const customerId = req.customer!.id;
  const menuItemId = String(req.params.menuItemId || '').trim();
  if (!menuItemId) return sendError(res, 'menuItemId is required');

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { favoriteItemIds: true },
  });

  let favorites: string[] = [];
  try {
    if (customer?.favoriteItemIds) favorites = JSON.parse(customer.favoriteItemIds);
  } catch {}

  const exists = favorites.includes(menuItemId);
  if (exists) {
    favorites = favorites.filter((id) => id !== menuItemId);
  } else {
    favorites.push(menuItemId);
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: { favoriteItemIds: JSON.stringify(favorites) },
  });

  return sendResponse(res, true, exists ? 'Removed from favorites' : 'Added to favorites', {
    isFavorite: !exists,
    favoriteItemIds: favorites,
  });
};
