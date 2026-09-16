import { Router } from 'express';
import { getCategoriesController, getCategoryController, createCategoryController, updateCategoryController, deleteCategoryController } from '../controllers/categoryController';
import { authenticate, authorize } from '../middleware/auth';

import { safeRouter } from '../utils/safeRouter';
const router = safeRouter();

router.use(authenticate);

router.get('/', getCategoriesController);
router.get('/:id', getCategoryController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createCategoryController);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateCategoryController);
router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deleteCategoryController);

export default router;
