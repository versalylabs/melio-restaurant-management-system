import { Router } from 'express';
import { loginController, setupController, getMeController, logoutController } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.post('/login', authRateLimiter, loginController);
router.post('/setup', authRateLimiter, setupController);
router.get('/me', authenticate, getMeController);
router.post('/logout', authenticate, logoutController);

export default router;
