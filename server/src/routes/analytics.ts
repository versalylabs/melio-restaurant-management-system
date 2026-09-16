import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { getAdvancedAnalytics } from '../controllers/analyticsController';
import { safeRouter } from '../utils/safeRouter';
const router=safeRouter();
router.get('/', authenticate, requirePermission('reports.view'), getAdvancedAnalytics);
export default router;
