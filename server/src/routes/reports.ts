import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getSalesReport, exportSalesReport } from '../controllers/reportController';
import { buildLossReport } from '../services/lossReportService';
import { sendResponse } from '../utils/response';
import { AuthRequest } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();
router.use(authenticate);
router.use(authorize('OWNER', 'ADMIN', 'MANAGER'));
router.get('/sales', getSalesReport);
router.get('/sales/export', exportSalesReport);
router.get('/loss-prevention', async (req: AuthRequest, res) => {
  // Staff tied to a branch only see their branch.
  const branchId = req.user!.branchId || (typeof req.query.branchId === 'string' && req.query.branchId ? req.query.branchId : undefined);
  const report = await buildLossReport(req.user!.restaurantId, {
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    branchId,
  });
  return sendResponse(res, true, 'Loss prevention report', report);
});
export default router;
