import { Router } from 'express';
import { getRestaurantController, updateRestaurantController } from '../controllers/restaurantController';
import { authenticate, authorize } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/', getRestaurantController);

router.put('/', authorize('OWNER', 'ADMIN', 'MANAGER'), updateRestaurantController);

export default router;
