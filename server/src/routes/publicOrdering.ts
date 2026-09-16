import { safeRouter } from '../utils/safeRouter';
import {
  getPublicRestaurantsController,
  getPublicMenuController,
  createPublicOrderController,
  confirmPublicPaymentController,
  getPublicOrderTrackingController,
  createPublicReservationController,
  getPublicReservationTrackingController,
  getPublicReservationAvailabilityController,
} from '../controllers/publicOrderingController';
import { publicApiRateLimiter, reservationRateLimiter } from '../middleware/rateLimiter';

const router = safeRouter();
router.get('/restaurants', publicApiRateLimiter, getPublicRestaurantsController);
router.get('/menu', publicApiRateLimiter, getPublicMenuController);
router.post('/orders', publicApiRateLimiter, createPublicOrderController);
router.get('/orders/:trackingToken', getPublicOrderTrackingController);
router.post('/orders/:trackingToken/pay/confirm', confirmPublicPaymentController);

// Public reservation routes
router.post('/reservations', reservationRateLimiter, createPublicReservationController);
router.get('/reservations/availability', publicApiRateLimiter, getPublicReservationAvailabilityController);
router.get('/reservations/:codeOrId', getPublicReservationTrackingController);

export default router;

