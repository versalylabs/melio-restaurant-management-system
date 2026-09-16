import { Router } from 'express';
import { getSectionsController, getSectionController, createSectionController, updateSectionController, deleteSectionController } from '../controllers/sectionController';
import { authenticate, authorize } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/', getSectionsController);
router.get('/:id', getSectionController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createSectionController);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateSectionController);
router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deleteSectionController);

export default router;
