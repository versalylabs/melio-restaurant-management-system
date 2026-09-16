import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getSalesReport, exportSalesReport } from '../controllers/reportController';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();
router.use(authenticate);
router.use(authorize('OWNER', 'ADMIN', 'MANAGER'));
router.get('/sales', getSalesReport);
router.get('/sales/export', exportSalesReport);
export default router;
