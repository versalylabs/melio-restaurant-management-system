import { Router } from 'express';
import { getTablesController, getTableController, createTableController, updateTableController, updateTablePositionController, updateTableStatusController, deleteTableController, getFloorLayoutController } from '../controllers/tableController';
import { authenticate, authorize } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/floor', getFloorLayoutController);
router.get('/', getTablesController);
router.get('/:id', getTableController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createTableController);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateTableController);
router.put('/:id/position', authorize('OWNER', 'ADMIN', 'MANAGER'), updateTablePositionController);
router.put('/:id/status', authorize('OWNER', 'ADMIN', 'MANAGER'), updateTableStatusController);
router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deleteTableController);

export default router;
