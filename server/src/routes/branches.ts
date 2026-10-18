import { Router } from 'express';
import { getBranchesController } from '../controllers/branchController';
import { getStockTransfers, createStockTransfer, completeStockTransfer, cancelStockTransfer, createBranch, updateBranch } from '../services/branchService';
import { authorizePermission, authorize } from '../middleware/auth';
import { authenticate } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/', getBranchesController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createBranch);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateBranch);
router.get('/transfers', authorizePermission('inventory.view'), getStockTransfers);
router.post('/transfers', authorizePermission('inventory.manage'), createStockTransfer);
router.post('/transfers/:id/complete', authorizePermission('inventory.manage'), completeStockTransfer);
router.post('/transfers/:id/cancel', authorizePermission('inventory.manage'), cancelStockTransfer);

export default router;
