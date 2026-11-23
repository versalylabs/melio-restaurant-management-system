import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getSalesReport, exportSalesReport } from '../controllers/reportController';
import { buildLossReport } from '../services/lossReportService';
import { buildTaxSummary, taxSummaryCsv } from '../services/taxService';
import { sendError } from '../utils/response';
import { sendResponse } from '../utils/response';
import { AuthRequest } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();
router.use(authenticate);
router.use(authorize('OWNER', 'ADMIN', 'MANAGER'));
router.get('/sales', getSalesReport);
router.get('/sales/export', exportSalesReport);
/** Monthly tax summary (?month=YYYY-MM), as JSON or, with &format=csv, a CSV for the accountant. */
router.get('/tax-summary', async (req: AuthRequest, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  const branchId = req.user!.branchId || (typeof req.query.branchId === 'string' && req.query.branchId ? req.query.branchId : undefined);
  const summary = await buildTaxSummary(req.user!.restaurantId, month, branchId);
  if (!summary) return sendError(res, 'Choose a month, e.g. 2026-11');
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tax-summary-${month}.csv"`);
    // Byte-order mark first, so Excel reads the file as UTF-8.
    return res.send(String.fromCharCode(0xfeff) + taxSummaryCsv(summary));
  }
  return sendResponse(res, true, 'Tax summary', summary);
});
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
