import { Router } from 'express';
import { getMenuItemsController, getMenuItemController, createMenuItemController, updateMenuItemController, deleteMenuItemController, duplicateMenuItemController } from '../controllers/menuItemController';
import { authenticate, authorize } from '../middleware/auth';
import multer from 'multer';
import { uploadMenuItemImage, removeMenuItemImage } from '../controllers/menuImageController';

import { safeRouter } from '../utils/safeRouter';
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

const router = safeRouter();

router.use(authenticate);

router.get('/', getMenuItemsController);
router.get('/:id', getMenuItemController);
router.post('/', authorize('OWNER', 'ADMIN', 'MANAGER'), createMenuItemController);
router.put('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), updateMenuItemController);
router.delete('/:id', authorize('OWNER', 'ADMIN', 'MANAGER'), deleteMenuItemController);
router.post('/:id/duplicate', authorize('OWNER', 'ADMIN', 'MANAGER'), duplicateMenuItemController);
router.post('/:id/image', authorize('OWNER', 'ADMIN', 'MANAGER'), imageUpload.single('image'), uploadMenuItemImage);
router.delete('/:id/image', authorize('OWNER', 'ADMIN', 'MANAGER'), removeMenuItemImage);

export default router;
