import { Router } from 'express';
import { getModifierGroupsController, getModifierGroupController, createModifierGroupController, updateModifierGroupController, deleteModifierGroupController } from '../controllers/modifierGroupController';
import { authenticate, authorize } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/', getModifierGroupsController);
router.get('/:id', getModifierGroupController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createModifierGroupController);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateModifierGroupController);
router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deleteModifierGroupController);

export default router;
