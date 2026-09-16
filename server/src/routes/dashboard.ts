import { Router } from 'express';
import { getDashboardController } from '../controllers/dashboardController';
import { authenticate } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/', getDashboardController);

export default router;
