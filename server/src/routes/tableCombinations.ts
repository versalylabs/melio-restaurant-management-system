import { Router } from 'express';
import { getTableCombinationsController, createTableCombinationController, updateTableCombinationController, deleteTableCombinationController } from '../controllers/tableCombinationController';
import { authenticate, authorize } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/', getTableCombinationsController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createTableCombinationController);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateTableCombinationController);
router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deleteTableCombinationController);

export default router;
