import { safeRouter } from '../utils/safeRouter';
import {
  registerCustomerController,
  loginCustomerController,
  getCustomerProfileController,
  updateCustomerProfileController,
  getCustomerOrdersController,
  getCustomerReservationsController,
  getCustomerLoyaltyController,
  toggleFavoriteItemController,
} from '../controllers/customerAuthController';
import { authenticateCustomer } from '../services/customerAuthService';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = safeRouter();

// Public customer authentication
router.post('/register', authRateLimiter, registerCustomerController);
router.post('/login', authRateLimiter, loginCustomerController);

// Authenticated customer self-service portal
router.use(authenticateCustomer as any);
router.get('/me', getCustomerProfileController as any);
router.put('/profile', updateCustomerProfileController as any);
router.get('/orders', getCustomerOrdersController as any);
router.get('/reservations', getCustomerReservationsController as any);
router.get('/loyalty', getCustomerLoyaltyController as any);
router.post('/favorites/:menuItemId', toggleFavoriteItemController as any);

export default router;
