import { safeRouter } from '../utils/safeRouter';
import {
  getPublicRestaurantsController,
  getPublicMenuController,
  createPublicOrderController,
  quotePublicOrderController,
  confirmPublicPaymentController,
  getPublicOrderTrackingController,
  createPublicReservationController,
  getPublicReservationTrackingController,
  getPublicReservationAvailabilityController,
} from '../controllers/publicOrderingController';
import { enquiryPerRestaurantLimiter, enquiryRateLimiter, publicApiRateLimiter, reservationRateLimiter } from '../middleware/rateLimiter';
import prisma from '../config/database';
import { createNotification } from '../services/notificationService';
import { sendError, sendResponse } from '../utils/response';

const router = safeRouter();
router.get('/restaurants', publicApiRateLimiter, getPublicRestaurantsController);
router.get('/menu', publicApiRateLimiter, getPublicMenuController);
router.post('/orders/quote', publicApiRateLimiter, quotePublicOrderController);
router.post('/orders', publicApiRateLimiter, createPublicOrderController);
router.get('/orders/:trackingToken', publicApiRateLimiter, getPublicOrderTrackingController);
router.post('/orders/:trackingToken/pay/confirm', confirmPublicPaymentController);

// Public reservation routes
router.post('/reservations', reservationRateLimiter, createPublicReservationController);
router.get('/reservations/availability', publicApiRateLimiter, getPublicReservationAvailabilityController);
router.get('/reservations/:codeOrId', publicApiRateLimiter, getPublicReservationTrackingController);

// Website enquiry form (catering, events, general): goes to owners, admins and managers as a notification.
const ENQUIRY_TYPES = ['General Enquiry', 'Office Lunch & Catering', 'Private Dining & Events', 'Press & Media'];
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
router.post('/enquiries', enquiryRateLimiter, enquiryPerRestaurantLimiter, async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 100);
  const phone = clean(b.phone, 25);
  const email = clean(b.email, 200);
  const subject = ENQUIRY_TYPES.includes(b.subject) ? b.subject : 'General Enquiry';
  const message = String(typeof b.message === 'string' ? b.message : '').trim().slice(0, 2000);
  if (!name || !message) return sendError(res, 'Please add your name and a message');
  const digits = phone.replace(/\D/g, '');
  if (!/^[\d\s()+-]+$/.test(phone) || digits.length < 9 || digits.length > 13) return sendError(res, 'Please enter a phone number we can call back');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 'Please check the email address');
  const restaurant = typeof b.restaurantId === 'string'
    ? await prisma.restaurant.findFirst({ where: { id: b.restaurantId, status: 'ACTIVE' }, select: { id: true } })
    : null;
  if (!restaurant) return sendError(res, 'Restaurant not found', undefined, 404);
  // Only people who follow up on leads see the customer's contact details.
  const users = await prisma.user.findMany({ where: { restaurantId: restaurant.id, status: 'ACTIVE', role: { name: { in: ['OWNER', 'ADMIN', 'MANAGER'] } } }, select: { id: true } });
  if (!users.length) return sendError(res, 'We could not send your message. Please call us instead.', undefined, 503);
  const text = `${name}, ${phone}${email ? `, ${email}` : ''}: ${message}`;
  await Promise.all(users.map((u) => createNotification({ restaurantId: restaurant.id, userId: u.id, type: 'WEBSITE_ENQUIRY', title: `Website enquiry: ${subject}`, message: text })));
  return sendResponse(res, true, 'Thanks, we have your message and will call you back.');
});

export default router;

